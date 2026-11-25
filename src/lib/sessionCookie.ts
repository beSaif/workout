/**
 * Keeps a late background response from reviving a session the user just ended.
 *
 * Auth.js's proxy (src/proxy.ts) re-issues the session cookie, with a fresh expiry, on
 * EVERY response it passes through, background ones included: router prefetches and RSC
 * fetches (`?_rsc=`) and `fetch()` calls. Signing out clears the cookie, but a prefetch
 * sent a moment earlier, while still signed in, can be answered a moment later and set
 * it again. The account is deleted and signed out, yet the next page load is signed in.
 *
 * So the session refresh is kept only on top-level page loads (the browser's navigation
 * requests), where it extends the session exactly as before, and dropped from background
 * responses. Every other cookie, and any cookie that CLEARS the session, passes through.
 */

/** Auth.js session cookie names, chunked (`.0`, `.1`, ...) or not, http or https. */
const SESSION_COOKIE = /^(__Secure-)?authjs\.session-token(\.\d+)?$/

type HeaderSource = { get(name: string): string | null }

/**
 * A request the page makes in the background rather than a page load, by the browser's
 * own Sec-Fetch-Dest header: `empty` for fetch() and Next.js RSC fetches and prefetches,
 * `document` for a page load. (Next strips its RSC / prefetch headers before the proxy
 * runs, so they cannot be used here.) Requests without the header (old browsers, curl)
 * count as page loads, so their behaviour is unchanged.
 */
export function isBackgroundRequest(headers: HeaderSource): boolean {
  const dest = headers.get("sec-fetch-dest")
  return dest !== null && dest !== "" && !["document", "iframe", "frame"].includes(dest)
}

/** A Set-Cookie header that (re)sets the session cookie, as opposed to clearing it. */
export function isSessionRefresh(setCookie: string): boolean {
  const [pair, ...attrs] = setCookie.split(";")
  const eq = pair.indexOf("=")
  if (eq < 0) return false
  const name = pair.slice(0, eq).trim()
  const value = pair.slice(eq + 1).trim()
  if (!SESSION_COOKIE.test(name) || value === "") return false
  for (const attr of attrs) {
    const [k, ...v] = attr.split("=")
    const key = k.trim().toLowerCase()
    const val = v.join("=").trim()
    if (key === "max-age" && Number(val) <= 0) return false
    if (key === "expires" && Date.parse(val) <= Date.now()) return false
  }
  return true
}

/** The Set-Cookie headers to send back: all of them, minus session refreshes on background responses. */
export function setCookiesFor(headers: HeaderSource, setCookies: string[]): string[] {
  return isBackgroundRequest(headers) ? setCookies.filter((c) => !isSessionRefresh(c)) : setCookies
}
