import { test as base, expect, type BrowserContext, type Request, type Route } from "@playwright/test"
import { encode } from "next-auth/jwt"

/**
 * Shared fixtures for the smoke specs.
 *
 * The app keeps its data in localStorage and syncs it to /api/*, which is backed by
 * Vercel KV — the SAME store production uses. So no test may ever reach those routes:
 * every same-origin /api/** request except /api/auth/** is answered here from an
 * in-memory fake, and `apiGuard` fails the test if one slips through to the network.
 *
 * Sign-in is forged: previews can't do Google OAuth, so `signIn` mints an Auth.js
 * session cookie with the preview's AUTH_SECRET (the E2E_AUTH_SECRET GitHub secret).
 */

export const E2E_USER = {
  sub: "e2e-smoke",
  name: "E2E Smoke",
  email: "e2e-smoke@example.invalid",
} as const

/** What a finished onboarding leaves behind: a lift-focused bench profile. */
export function onboardedProfile() {
  return {
    email: E2E_USER.email,
    name: E2E_USER.name,
    bw: 80,
    trainingMode: "lift-focused",
    mainLift: "bench",
    anchor: 80,
    target: 100,
    trainingAge: "some",
    // Answered, so the one-time bodyweight opt-in sheet stays shut.
    weighInDaily: false,
    createdAt: new Date().toISOString(),
  }
}

/** Same-origin data APIs, i.e. everything under /api except Auth.js's own routes. */
function isDataApi(url: URL, origin: string): boolean {
  return url.origin === origin && url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/auth/")
}

/**
 * In-memory stand-in for the /api routes, shaped like src/app/api/**. A POST to a
 * resource is what the next GET of it returns, like KV; never-written resources answer
 * the way the real routes do for a new account (mostly `null`, which tells
 * src/lib/storage.ts to keep its local copy).
 */
export class FakeApi {
  private readonly store = new Map<string, unknown>()
  /** Every request answered, in order, for assertions. */
  readonly calls: { method: string; path: string; body: unknown }[] = []

  seed(path: string, value: unknown): void {
    this.store.set(path, value)
  }

  get(path: string): unknown {
    return this.store.get(path)
  }

  /** The last body POSTed to `path`, or undefined. */
  lastPost(path: string): unknown {
    return [...this.calls].reverse().find((c) => c.method === "POST" && c.path === path)?.body
  }

  respond(method: string, path: string, body: unknown): { status: number; json: unknown } {
    this.calls.push({ method, path, body })

    if (method === "GET") {
      if (this.store.has(path)) return { status: 200, json: this.store.get(path) }
      switch (path) {
        case "/api/presence":
        case "/api/friends":
        case "/api/messages":
        case "/api/users/search":
        case "/api/users/people":
          return { status: 200, json: [] }
        case "/api/friends/requests":
          return { status: 200, json: { requests: [], count: 0 } }
        case "/api/plan":
          return { status: 200, json: { available: false, remaining: 0, limit: 0, following: false, athleteCount: 0 } }
        case "/api/friends/profile":
          return { status: 404, json: { error: "not found" } }
        default:
          // profile, sessions, weights, exercises, training-days, coach: "never saved".
          return { status: 200, json: null }
      }
    }

    if (method === "DELETE") {
      this.store.delete(path)
      return { status: 200, json: { ok: true } }
    }

    // POST / PUT: keep the body so the next GET echoes it.
    if (path === "/api/profile") {
      const existing = (this.store.get(path) ?? {}) as Record<string, unknown>
      const profile = {
        ...existing,
        ...(body as Record<string, unknown>),
        email: E2E_USER.email,
        createdAt: existing.createdAt ?? new Date().toISOString(),
      }
      this.store.set(path, profile)
      return { status: 200, json: profile }
    }
    if (path === "/api/plan") return { status: 503, json: { error: "unavailable" } }
    this.store.set(path, body)
    return { status: 200, json: { ok: true } }
  }
}

/**
 * Route every data-API request in `context` to `fake`, and record which requests were
 * answered that way. Context-level (not page-level) so popups and, in Chromium,
 * service-worker requests are covered too.
 */
async function installApiFake(context: BrowserContext, origin: string, fake: FakeApi): Promise<Set<Request>> {
  const handled = new Set<Request>()
  await context.route(
    (url) => isDataApi(url, origin),
    async (route: Route) => {
      const req = route.request()
      handled.add(req)
      const url = new URL(req.url())
      let body: unknown = null
      const raw = req.postData()
      if (raw) {
        try {
          body = JSON.parse(raw)
        } catch {
          body = raw
        }
      }
      const { status, json } = fake.respond(req.method(), url.pathname, body)
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(json) })
    },
  )
  return handled
}

type Fixtures = {
  /** The in-memory /api backend for this test. */
  api: FakeApi
  /** Auto: installs the fake and fails the test if a data-API request hits the network. */
  apiGuard: void
  /** Adds a forged Auth.js session cookie for E2E_USER and seeds an onboarded profile. */
  signIn: () => Promise<void>
  /** Uncaught exceptions thrown in any page of the test. */
  pageErrors: Error[]
}

export const test = base.extend<Fixtures>({
  api: async ({}, provide) => {
    await provide(new FakeApi())
  },

  apiGuard: [
    async ({ context, api, baseURL }, provide) => {
      const origin = new URL(baseURL!).origin
      const handled = await installApiFake(context, origin, api)
      const leaked: string[] = []
      context.on("request", (req) => {
        const url = new URL(req.url())
        if (!isDataApi(url, origin)) return
        // Checked once the request settles, by which time the route handler has run.
        void req
          .response()
          .catch(() => null)
          .then(() => {
            if (!handled.has(req)) leaked.push(`${req.method()} ${url.pathname}`)
          })
      })
      await provide()
      // Give any request still in flight a moment to settle before judging.
      await new Promise((r) => setTimeout(r, 250))
      expect(leaked, "data-API requests must never reach the real (shared) KV backend").toEqual([])
    },
    { auto: true },
  ],

  signIn: async ({ context, api, baseURL }, provide) => {
    await provide(async () => {
      const secret = process.env.E2E_AUTH_SECRET
      if (!secret) throw new Error("E2E_AUTH_SECRET is not set: it must equal the deployment's AUTH_SECRET")
      const url = new URL(baseURL!)
      const secure = url.protocol === "https:"
      // Auth.js names (and salts) the cookie by scheme: previews are https.
      const cookieName = secure ? "__Secure-authjs.session-token" : "authjs.session-token"
      const value = await encode({
        token: { sub: E2E_USER.sub, name: E2E_USER.name, email: E2E_USER.email },
        secret,
        salt: cookieName,
      })
      await context.addCookies([
        { name: cookieName, value, domain: url.hostname, path: "/", httpOnly: true, secure, sameSite: "Lax" },
      ])
      api.seed("/api/profile", onboardedProfile())
      // Device-local one-offs that would otherwise cover the home screen on first load.
      await context.addInitScript(() => {
        try {
          localStorage.setItem("installGuideDismissed", "1")
          localStorage.setItem("lift-tracker-whats-new-seen", "999999")
        } catch {
          // Storage unavailable: the modals would show, and the specs would fail loudly.
        }
      })
    })
  },

  pageErrors: async ({ page, baseURL }, provide) => {
    const origin = new URL(baseURL!).origin
    const errors: Error[] = []
    page.on("pageerror", (err) => {
      if (!isCancelledSameOriginFetch(err, origin)) errors.push(err)
    })
    await provide(errors)
  },
})

/**
 * WebKit reports a fetch that a reload or navigation cancels as an uncaught page error:
 * "Fetch API cannot load <url> due to access control checks." In this app those are the
 * Next.js router's own same-origin fetches (route prefetches and RSC navigation
 * requests) torn down with the old page, which is not the app failing. The URL does not
 * always show it: locally it carries `?_rsc=`, on Vercel it can be the bare page URL.
 *
 * So exactly that message is ignored, and only for a URL on the deployment's own
 * origin. The same message for any other origin is a real CORS failure and still counts.
 */
function isCancelledSameOriginFetch(err: Error, origin: string): boolean {
  // Playwright sometimes splits WebKit's text at its first colon, which lands the URL's
  // scheme in `name` and the rest in `message`; try the text both whole and rejoined.
  for (const text of [err.message, `${err.name}:${err.message}`]) {
    const match = /^Fetch API cannot load (\S+) due to access control checks\.$/.exec(text)
    if (!match) continue
    try {
      return new URL(match[1]).origin === origin
    } catch {
      return false
    }
  }
  return false
}

export { expect }
