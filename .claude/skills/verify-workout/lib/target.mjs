// Which hosts verify-workout and its fuzz harness may drive. Shared by verify.mjs (which
// never drives production) and fuzz/fuzz.mjs (which may, read-only, with
// --allow-production). Keep this the single list of production hostnames.

/**
 * Production: the custom domain and the original vercel.app alias of the production
 * deployment. Both serve the real app against the real KV store.
 */
export const PRODUCTION_HOSTS = Object.freeze(["workout.codesaif.dev", "bench-tracker.vercel.app"])

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"])

/**
 * Classify a base URL: "local" (localhost / 127.0.0.1), "production" (PRODUCTION_HOSTS),
 * "preview" (any other *.vercel.app host) or "other" (anything else, or not a URL).
 */
export function classifyTarget(baseUrl) {
  let url
  try {
    url = new URL(baseUrl)
  } catch {
    return "other"
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "other"
  // A URL with credentials in it is not something either tool should be pointed at.
  if (url.username || url.password) return "other"
  const host = url.hostname.toLowerCase().replace(/\.$/, "")
  if (PRODUCTION_HOSTS.includes(host)) return "production"
  if (LOCAL_HOSTS.has(host)) return "local"
  if (url.protocol === "https:" && /^[a-z0-9-]+(\.[a-z0-9-]+)*\.vercel\.app$/.test(host)) return "preview"
  return "other"
}

/**
 * The fuzz harness's target guard. Local servers and Vercel previews are allowed;
 * production only with `allowProduction` (the --allow-production flag); anything else
 * is refused. Returns { ok, kind, production, reason }.
 */
export function checkFuzzTarget(baseUrl, { allowProduction = false } = {}) {
  const kind = classifyTarget(baseUrl)
  if (kind === "local" || kind === "preview") return { ok: true, kind, production: false, reason: `${kind} target` }
  if (kind === "production") {
    return allowProduction
      ? { ok: true, kind, production: true, reason: "production, allowed by --allow-production" }
      : { ok: false, kind, production: true, reason: "target is production: pass --allow-production to fuzz it (read-only, every write blocked)" }
  }
  return { ok: false, kind, production: false, reason: "target is not localhost, a *.vercel.app preview or a known production host" }
}
