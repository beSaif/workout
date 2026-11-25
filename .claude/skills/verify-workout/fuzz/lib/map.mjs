// The feature map as the fuzz harness reads it: features/*.md (ids), features/routes.json
// (entry route and whether it needs a session) and the routes each feature documents.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
export const FEATURES_DIR = path.join(SKILL_DIR, "features")

/** Public pages: reachable without a session (src/proxy.ts lets them through). */
export const PUBLIC_ROUTES = Object.freeze(["/welcome", "/onboarding"])

/** Sample values for dynamic segments, so a documented `/session/<id>` can be requested. */
const SAMPLE_SEGMENTS = { id: "1", email: "someone%40workout.invalid", groupId: "back" }

export function featureIds(dir = FEATURES_DIR) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .map((f) => f.replace(/\.md$/, ""))
    .sort()
}

/** features/routes.json: { "<feature id>": { route, signedIn } }. */
export function loadRoutes(dir = FEATURES_DIR) {
  return JSON.parse(fs.readFileSync(path.join(dir, "routes.json"), "utf8"))
}

/**
 * Every page route the feature files document under "How to get to it (user POV)" (the
 * same backticked routes src/test/repo-policy.test.ts maps), query strings dropped and
 * dynamic segments filled with sample values.
 */
export function documentedRoutes(dir = FEATURES_DIR) {
  const routes = new Set()
  for (const id of featureIds(dir)) {
    const text = fs.readFileSync(path.join(dir, `${id}.md`), "utf8")
    const section = text.split(/^## /m).find((s) => s.startsWith("How to get to it")) ?? ""
    for (const [, raw] of section.matchAll(/`(\/[^`\s]*)`/g)) {
      const route = raw.replace(/[?(].*$/, "").replace(/<(\w+)>/g, (_, name) => SAMPLE_SEGMENTS[name] ?? "1")
      routes.add(route)
    }
  }
  return [...routes].sort()
}

/** Documented routes that need a session: each must send a signed-out visitor to /welcome. */
export function protectedRoutes(dir = FEATURES_DIR) {
  return documentedRoutes(dir).filter((r) => !PUBLIC_ROUTES.includes(r))
}

/**
 * Which phases a run has and why one is skipped. The signed-out phase always runs; the
 * signed-in phase needs a session secret for this target and is skipped otherwise
 * (production normally has none available).
 */
export function planPhases({ authSecret, signedOutOnly = false }) {
  const signedIn = signedOutOnly
    ? { name: "signed-in", signedIn: true, status: "skipped", skippedReason: "--signed-out-only" }
    : !authSecret
      ? { name: "signed-in", signedIn: true, status: "skipped", skippedReason: "no auth secret for this target" }
      : { name: "signed-in", signedIn: true, status: "pending" }
  return [{ name: "signed-out", signedIn: false, status: "pending" }, signedIn]
}
