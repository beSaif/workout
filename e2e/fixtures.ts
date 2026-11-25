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

/** Who a forged session signs in as. Always a test identity, never a real account. */
export type TestUser = { readonly sub: string; readonly name: string; readonly email: string }

export const E2E_USER: TestUser = {
  sub: "e2e-smoke",
  name: "E2E Smoke",
  email: "e2e-smoke@example.invalid",
}

/** What a finished onboarding leaves behind: a lift-focused bench profile. */
export function onboardedProfile(user: TestUser = E2E_USER) {
  return {
    email: user.email,
    name: user.name,
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
export function isDataApi(url: URL, origin: string): boolean {
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
  /** The signed-in account; `signIn` sets it. Profile writes are stored under its email. */
  user: TestUser = E2E_USER
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
        email: this.user.email,
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
export async function installApiFake(context: BrowserContext, origin: string, fake: FakeApi): Promise<Set<Request>> {
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

/**
 * Watch `context` for data-API requests the fake did not answer (`handled` comes from
 * installApiFake). The returned list fills in as such requests settle: each entry is a
 * request that reached the network, i.e. the real (shared) KV backend.
 */
export function trackApiLeaks(context: BrowserContext, origin: string, handled: Set<Request>): string[] {
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
  return leaked
}

/**
 * Sign `context` in as `user` (default E2E_USER): a forged Auth.js session cookie minted
 * with E2E_AUTH_SECRET (= the target's AUTH_SECRET), an onboarded profile seeded into
 * `api`, and the device-local one-offs (install guide, What's new) dismissed.
 */
export async function signInContext(context: BrowserContext, api: FakeApi, baseURL: string, user: TestUser = E2E_USER): Promise<void> {
  const secret = process.env.E2E_AUTH_SECRET
  if (!secret) throw new Error("E2E_AUTH_SECRET is not set: it must equal the deployment's AUTH_SECRET")
  const url = new URL(baseURL)
  const secure = url.protocol === "https:"
  // Auth.js names (and salts) the cookie by scheme: previews are https.
  const cookieName = secure ? "__Secure-authjs.session-token" : "authjs.session-token"
  const value = await encode({
    token: { sub: user.sub, name: user.name, email: user.email },
    secret,
    salt: cookieName,
  })
  // Host-only, like the cookie Auth.js sets for a real user: `url` (not `domain`) makes
  // Playwright store it without a Domain attribute. A domain cookie would survive
  // Auth.js's sign-out, which clears only the host-only one. The path is "/" from the URL.
  await context.addCookies([
    { name: cookieName, value, url: `${url.origin}/`, httpOnly: true, secure, sameSite: "Lax" },
  ])
  api.user = user
  api.seed("/api/profile", onboardedProfile(user))
  // Device-local one-offs that would otherwise cover the home screen on first load.
  await context.addInitScript(() => {
    try {
      localStorage.setItem("installGuideDismissed", "1")
      localStorage.setItem("lift-tracker-whats-new-seen", "999999")
    } catch {
      // Storage unavailable: the modals would show, and the specs would fail loudly.
    }
  })
}

type Fixtures = {
  /** The in-memory /api backend for this test. */
  api: FakeApi
  /** Auto: installs the fake and fails the test if a data-API request hits the network. */
  apiGuard: void
  /** Adds a forged Auth.js session cookie for `user` (default E2E_USER) and seeds an onboarded profile. */
  signIn: (user?: TestUser) => Promise<void>
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
      const leaked = trackApiLeaks(context, origin, handled)
      await provide()
      // Give any request still in flight a moment to settle before judging.
      await new Promise((r) => setTimeout(r, 250))
      expect(leaked, "data-API requests must never reach the real (shared) KV backend").toEqual([])
    },
    { auto: true },
  ],

  signIn: async ({ context, api, baseURL }, provide) => {
    await provide((user?: TestUser) => signInContext(context, api, baseURL!, user))
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
export function isCancelledSameOriginFetch(err: Error, origin: string): boolean {
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
