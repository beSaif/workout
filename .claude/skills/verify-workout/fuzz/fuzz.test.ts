// Unit tests for the verify-workout fuzz harness (run by `pnpm test`, so CI runs them).
// The browser-side guarantees (fresh contexts, the fake answering every data request,
// writes aborted) are tested end to end by `fuzz.mjs selftest` against a local server.
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { isMuscleGroupConfigArray, isTrainingDayArray, parseSessionsPayload } from "@/lib/validate"
import { checkFuzzTarget, classifyTarget, PRODUCTION_HOSTS } from "../lib/target.mjs"
import { doctor } from "../verify.mjs"
import { BLOCKED_KINDS, classifyRequest } from "./lib/classify.mjs"
import { featureIds, loadRoutes, planPhases, protectedRoutes, PUBLIC_ROUTES } from "./lib/map.mjs"
import { isAllowlisted, loadAllowlist, loadKnownIssues, redact, renderSummary } from "./lib/report.mjs"
import { createRng, hashSeed } from "./lib/rng.mjs"
import { findingSignature, normalizeMessage, routePattern } from "./lib/signature.mjs"
import { EDGE_INPUTS, FUZZ_USER, generateState } from "./lib/state.mjs"

const ALLOWLIST = path.join(__dirname, "allowlist.json")
const KNOWN_ISSUES = path.join(__dirname, "known-issues.json")

const draw = (seed: number, n = 20) => {
  const r = createRng(seed)
  return Array.from({ length: n }, () => r.next())
}

describe("seeded RNG", () => {
  it("replays the same sequence for the same seed", () => {
    expect(draw(1)).toEqual(draw(1))
    expect(draw(123456789)).toEqual(draw(123456789))
  })

  it("gives different sequences for different seeds, all in [0, 1)", () => {
    expect(draw(1)).not.toEqual(draw(2))
    for (const x of draw(7, 1000)) expect(x >= 0 && x < 1).toBe(true)
  })

  it("forks independent, reproducible streams by label", () => {
    const a = createRng(42)
    const b = createRng(42)
    // Drawing from the parent must not shift a fork.
    a.next()
    expect(a.fork("actions").next()).toBe(b.fork("actions").next())
    expect(createRng(42).fork("state").next()).not.toBe(createRng(42).fork("actions").next())
    expect(hashSeed(1, "home-dashboard")).toBe(hashSeed(1, "home-dashboard"))
    expect(hashSeed(1, "home-dashboard")).not.toBe(hashSeed(2, "home-dashboard"))
  })

  it("keeps int, pick and weighted inside their ranges", () => {
    const r = createRng(9)
    for (let i = 0; i < 500; i++) {
      const n = r.int(-3, 3)
      expect(Number.isInteger(n) && n >= -3 && n <= 3).toBe(true)
      expect(["a", "b"]).toContain(r.pick(["a", "b"]))
      expect(r.weighted([["x", 1], ["y", 0]])).toBe("x")
    }
  })

  it("generates the same account state for the same seed", () => {
    const now = Date.UTC(2026, 10, 25, 12)
    expect(generateState(createRng(5), FUZZ_USER, now)).toEqual(generateState(createRng(5), FUZZ_USER, now))
  })
})

describe("seeded account state", () => {
  const now = Date.UTC(2026, 10, 25, 12)
  const states = Array.from({ length: 200 }, (_, seed) => generateState(createRng(seed), FUZZ_USER, now))

  it("is always the dedicated fuzz test user, never a real account", () => {
    expect(FUZZ_USER).toEqual({ sub: "fuzz-bot", email: "fuzz-bot@workout.invalid", name: "Fuzz Bot" })
    for (const s of states) expect(s.profile.email).toBe("fuzz-bot@workout.invalid")
  })

  it("passes the server's own validators, so it is a state a real account can be in", () => {
    for (const s of states) {
      if (s.sessions) expect(parseSessionsPayload(s.sessions)).not.toBeNull()
      if (s.exercises) expect(isMuscleGroupConfigArray(s.exercises)).toBe(true)
      if (s.trainingDays) expect(isTrainingDayArray(s.trainingDays)).toBe(true)
      if (s.weights) for (const w of s.weights) expect(w.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it("covers both modes, 0-40 sessions, and edge loads", () => {
    const modes = new Set(states.map((s) => s.profile.trainingMode))
    expect(modes).toEqual(new Set(["lift-focused", "balanced"]))
    const counts = states.map((s) => s.sessions?.sessions.length ?? 0)
    expect(Math.min(...counts)).toBe(0)
    expect(Math.max(...counts)).toBeLessThanOrEqual(40)
    expect(Math.max(...counts)).toBeGreaterThan(30)
    expect(states.some((s) => s.profile.anchor === 1)).toBe(true)
    expect(states.some((s) => s.profile.anchor === 500)).toBe(true)
  })

  it("types the edge values the brief asks for and none the bad-text check looks for", () => {
    for (const v of ["0", "-1", "999999", "12,5", "12.5", "", "   "]) expect(EDGE_INPUTS).toContain(v)
    expect(EDGE_INPUTS.some((v: string) => v.length === 200)).toBe(true)
    expect(EDGE_INPUTS.some((v: string) => /\p{Extended_Pictographic}/u.test(v))).toBe(true)
    for (const v of EDGE_INPUTS) expect(v).not.toMatch(/NaN|undefined|null|Infinity|object Object|Invalid Date/)
  })
})

describe("finding signatures", () => {
  it("normalizes numbers, urls, emails and ids", () => {
    expect(normalizeMessage("GET https://x.vercel.app/api/a?b=1 failed")).toBe("GET <url> failed")
    expect(normalizeMessage("user fuzz-bot@workout.invalid not found")).toBe("user <email> not found")
    expect(normalizeMessage("id 3f2b8c1e-1d2a-4f00-9a3b-123456789abc")).toBe("id <id>")
    expect(normalizeMessage("visible \"NaN\" in \"12,5 kg × 3\"")).toBe("visible \"NaN\" in \"<n> kg × <n>\"")
    expect(normalizeMessage("  a \n\t b  ")).toBe("a b")
  })

  it("maps URLs to route patterns", () => {
    expect(routePattern("http://localhost:3210/session/12?x=1#y")).toBe("/session/<n>")
    expect(routePattern("/friends/someone%40workout.invalid")).toBe("/friends/<email>")
    expect(routePattern("https://workout.codesaif.dev/")).toBe("/")
    expect(routePattern("/exercises/back/")).toBe("/exercises/back")
  })

  it("is stable across runs that differ only in numbers, ids and hosts", () => {
    const a = findingSignature({ kind: "bad-text", route: "http://localhost:3210/session/3", message: 'visible "NaN" in "Session 3 · 80kg"' })
    const b = findingSignature({ kind: "bad-text", route: "https://p-1.vercel.app/session/17", message: 'visible "NaN" in "Session 17 · 142.5kg"' })
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{12}$/)
  })

  it("differs by kind, route and wording", () => {
    const base = { kind: "page-error", route: "/", message: "TypeError: x is undefined" }
    const sig = findingSignature(base)
    expect(findingSignature({ ...base, kind: "console-error" })).not.toBe(sig)
    expect(findingSignature({ ...base, route: "/profile" })).not.toBe(sig)
    expect(findingSignature({ ...base, message: "TypeError: y is undefined" })).not.toBe(sig)
  })
})

describe("target guard", () => {
  it("allows local servers and Vercel previews", () => {
    for (const url of ["http://localhost:3210", "http://127.0.0.1:3000", "https://workout-git-feature-besaif.vercel.app"]) {
      expect(checkFuzzTarget(url)).toMatchObject({ ok: true, production: false })
    }
  })

  it("refuses production without --allow-production, for every production host", () => {
    expect(PRODUCTION_HOSTS).toContain("workout.codesaif.dev")
    expect(PRODUCTION_HOSTS.length).toBe(2)
    for (const host of PRODUCTION_HOSTS) {
      for (const url of [`https://${host}`, `https://${host.toUpperCase()}/`, `https://${host}./welcome`]) {
        expect(classifyTarget(url)).toBe("production")
        expect(checkFuzzTarget(url)).toMatchObject({ ok: false, production: true })
        expect(checkFuzzTarget(url, { allowProduction: true })).toMatchObject({ ok: true, production: true })
      }
    }
  })

  it("refuses everything else, even with --allow-production", () => {
    for (const url of ["https://example.com", "http://preview.vercel.app", "https://evil.com/?x=.vercel.app", "https://user:pw@localhost", "ftp://localhost", "not a url", "https://workout.codesaif.dev.evil.com"]) {
      expect(checkFuzzTarget(url, { allowProduction: true }).ok, url).toBe(false)
    }
  })

  it("leaves verify.mjs refusing production (its doctor sends no request there)", async () => {
    for (const host of PRODUCTION_HOSTS) {
      expect(await doctor({ kind: "deployed", baseUrl: `https://${host}` })).toBe(false)
    }
  })
})

describe("request classifier", () => {
  const origin = "https://workout.codesaif.dev"
  const c = (method: string, url: string, extra: { headers?: Record<string, string>; production?: boolean; navigation?: boolean } = {}) =>
    classifyRequest({ method, url: url.startsWith("/") ? origin + url : url, origin, production: extra.production ?? true, headers: extra.headers, navigation: extra.navigation })

  it("sends every /api data call, read or write, to the fake", () => {
    for (const m of ["GET", "POST", "PUT", "DELETE"]) expect(c(m, "/api/sessions")).toEqual({ kind: "data-api", action: "fake" })
    expect(c("GET", "/api/friends/profile?email=a")).toMatchObject({ action: "fake" })
  })

  it("aborts every cross-origin request", () => {
    expect(c("GET", "https://accounts.google.com/o/oauth2/v2/auth")).toEqual({ kind: "external", action: "abort" })
    expect(c("POST", "https://fcm.googleapis.com/fcm/send")).toMatchObject({ action: "abort" })
    expect(c("GET", "http://workout.codesaif.dev/")).toMatchObject({ kind: "external" })
  })

  it("aborts server actions, form posts and any other same-origin write", () => {
    expect(c("POST", "/welcome", { headers: { "Next-Action": "abc123" } })).toEqual({ kind: "server-action", action: "abort" })
    expect(c("POST", "/", { headers: { "content-type": "application/x-www-form-urlencoded" } })).toEqual({ kind: "form-post", action: "abort" })
    expect(c("POST", "/", { headers: { "content-type": "multipart/form-data; boundary=x" } })).toMatchObject({ kind: "form-post" })
    expect(c("POST", "/welcome", { navigation: true })).toMatchObject({ kind: "form-post", action: "abort" })
    expect(c("PUT", "/anything", { headers: { "content-type": "application/json" } })).toEqual({ kind: "other-write", action: "abort" })
    expect(c("DELETE", "/_next/whatever")).toMatchObject({ action: "abort" })
  })

  it("on production aborts Auth.js POSTs except sign-out", () => {
    expect(c("POST", "/api/auth/signin/google")).toEqual({ kind: "auth-write", action: "abort" })
    expect(c("POST", "/api/auth/callback/credentials")).toMatchObject({ action: "abort" })
    expect(c("POST", "/api/auth/signout")).toEqual({ kind: "auth-signout", action: "allow" })
    expect(c("GET", "/api/auth/session")).toEqual({ kind: "auth-read", action: "allow" })
    expect(c("POST", "/api/auth/signin/google", { production: false })).toMatchObject({ action: "allow" })
  })

  it("lets same-origin reads through", () => {
    for (const url of ["/", "/welcome", "/_next/static/chunks/a.js", "/manifest.webmanifest", "/sw.js", "/?_rsc=1"]) {
      expect(c("GET", url)).toEqual({ kind: "read", action: "allow" })
    }
    expect(c("HEAD", "/")).toMatchObject({ action: "allow" })
    expect(c("GET", "data:image/png;base64,AAAA")).toMatchObject({ kind: "non-http", action: "allow" })
  })

  it("only ever aborts with a kind the report counts", () => {
    const urls = ["/", "/api/auth/signin", "/api/x", "https://e.com/"]
    for (const m of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      for (const u of urls) {
        const r = c(m, u, { headers: { "next-action": "1" } })
        if (r.action === "abort") expect(BLOCKED_KINDS).toContain(r.kind)
      }
    }
  })
})

describe("phases", () => {
  it("skips the signed-in phase when there is no auth secret for the target", () => {
    expect(planPhases({ authSecret: undefined })).toEqual([
      { name: "signed-out", signedIn: false, status: "pending" },
      { name: "signed-in", signedIn: true, status: "skipped", skippedReason: "no auth secret for this target" },
    ])
    expect(planPhases({ authSecret: "s3cret", signedOutOnly: true })[1]).toMatchObject({ status: "skipped", skippedReason: "--signed-out-only" })
    expect(planPhases({ authSecret: "s3cret" })[1]).toMatchObject({ status: "pending" })
  })
})

describe("feature map for the fuzz harness", () => {
  it("features/routes.json lists exactly the feature files", () => {
    expect(Object.keys(loadRoutes()).sort()).toEqual(featureIds())
  })

  it("gives every feature a same-origin entry route and a signedIn flag", () => {
    for (const [id, r] of Object.entries(loadRoutes() as Record<string, { route: string; signedIn: boolean }>)) {
      expect(r.route, id).toMatch(/^\/[^/]?/)
      expect(typeof r.signedIn, id).toBe("boolean")
      expect(r.signedIn, `${id}: public routes are exactly the signed-out entry points`).toBe(!PUBLIC_ROUTES.includes(r.route))
    }
  })

  it("derives the protected routes from the feature files", () => {
    const routes = protectedRoutes()
    for (const r of ["/", "/profile", "/history", "/session/1", "/exercises/back"]) expect(routes).toContain(r)
    for (const r of PUBLIC_ROUTES) expect(routes).not.toContain(r)
  })
})

describe("allowlist, known issues and redaction", () => {
  it("gives every allowlist entry a reason and a valid pattern", () => {
    const list = loadAllowlist(ALLOWLIST)
    expect(list.length).toBeGreaterThan(0)
    expect(isAllowlisted(list, { message: "Failed to load resource: net::ERR_BLOCKED_BY_CLIENT" })).toBe(true)
    expect(isAllowlisted(list, { message: "TypeError: boom" })).toBe(false)
  })

  it("keys known issues by signature, pointing at GitHub issues", () => {
    expect(() => loadKnownIssues(KNOWN_ISSUES)).not.toThrow()
    const dir = fs.mkdtempSync(path.join(process.cwd(), "node_modules/.fuzz-test-"))
    const bad = path.join(dir, "k.json")
    fs.writeFileSync(bad, JSON.stringify({ abc: "https://example.com" }))
    expect(() => loadKnownIssues(bad)).toThrow(/signature/)
    fs.rmSync(dir, { recursive: true })
  })

  it("never lets a secret through", () => {
    const secret = "super-secret-value-123"
    const text = `token ${secret} enc ${encodeURIComponent(secret)} cookie authjs.session-token=abc.def; x-vercel-protection-bypass: zzz eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2In0..a.b.c`
    const out = redact(text, { E2E_AUTH_SECRET: secret })
    expect(out).not.toContain(secret)
    expect(out).not.toContain("abc.def")
    expect(out).not.toContain("zzz")
    expect(out).not.toContain("eyJhbGci")
  })

  it("renders a summary with each finding's repro steps", () => {
    const md = renderSummary({
      target: "http://localhost:3210",
      production: false,
      seed: 1,
      startedAt: "2026-11-25T00:00:00.000Z",
      durationMs: 1000,
      options: "",
      phases: [{ name: "signed-out", signedIn: false, status: "failed" }],
      journeys: [],
      monkeys: [],
      actions: 3,
      blockedRequests: { "server-action": 1 },
      apiLeaks: 0,
      findings: [{ signature: "0123456789ab", kind: "bad-text", feature: "weight", route: "/weight", message: 'visible "NaN"', reproducible: true, known: null, steps: ["open /weight", "click button \"Save\""], screenshot: "x.png" }],
    })
    expect(md).toContain("Seed: `1`")
    expect(md).toContain("NEW `0123456789ab` bad-text")
    expect(md).toContain('2. click button "Save"')
  })
})
