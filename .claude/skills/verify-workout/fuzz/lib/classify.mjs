// The fuzz harness's request classifier: what happens to each request a page makes.
// One decision per request, so the safety model is one function with one test.
//
//   fake    same-origin /api/** except /api/auth/**: answered in the browser by FakeApi
//   allow   reads (GET/HEAD) of the app's own origin, Auth.js reads, sign-out
//   abort   everything else, recorded by kind (never sent)

/** Kinds that are aborted. Each run counts them in fuzz-report.json `blockedRequests`. */
export const BLOCKED_KINDS = Object.freeze(["external", "server-action", "auth-write", "form-post", "other-write"])

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

function header(headers, name) {
  if (!headers) return undefined
  const want = name.toLowerCase()
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === want) return v
  return undefined
}

/**
 * @param {{ method: string, url: string, headers?: Record<string, string>, origin: string,
 *           production: boolean, navigation?: boolean }} req
 * @returns {{ kind: string, action: "fake" | "allow" | "abort" }}
 */
export function classifyRequest({ method, url, headers = {}, origin, production, navigation = false }) {
  let u
  try {
    u = new URL(url)
  } catch {
    return { kind: "other-write", action: "abort" }
  }
  // data:, blob:, about: and the like never leave the browser.
  if (u.protocol !== "http:" && u.protocol !== "https:") return { kind: "non-http", action: "allow" }
  if (u.origin !== origin) return { kind: "external", action: "abort" }

  const m = String(method).toUpperCase()
  const path = u.pathname
  const isAuth = path === "/api/auth" || path.startsWith("/api/auth/")

  // Every data-API call, read or write, goes to the in-browser fake: the real routes
  // read and write the shared KV store.
  if (path.startsWith("/api/") && !isAuth) return { kind: "data-api", action: "fake" }

  // A Next.js server action is a POST to a page URL carrying Next-Action. It runs code on
  // the server (here: Auth.js sign-in), so it is never sent, on any target.
  if (header(headers, "next-action") !== undefined && !READ_METHODS.has(m)) return { kind: "server-action", action: "abort" }

  if (isAuth) {
    if (READ_METHODS.has(m)) return { kind: "auth-read", action: "allow" }
    // Signing out only clears the (forged) session cookie.
    if (path === "/api/auth/signout") return { kind: "auth-signout", action: "allow" }
    // Production: no sign-in / callback POSTs at all. Local servers and previews start
    // the OAuth redirect, whose cross-origin hop to Google is aborted anyway.
    return production ? { kind: "auth-write", action: "abort" } : { kind: "auth-write-local", action: "allow" }
  }

  if (READ_METHODS.has(m)) return { kind: "read", action: "allow" }

  const type = String(header(headers, "content-type") ?? "").toLowerCase()
  if (navigation || type.startsWith("application/x-www-form-urlencoded") || type.startsWith("multipart/form-data")) {
    return { kind: "form-post", action: "abort" }
  }
  return { kind: "other-write", action: "abort" }
}
