// Finding signatures: a stable short hash of (kind, route pattern, normalized message),
// so the same bug found on another night, with other numbers in it, is the same finding
// and can be matched against fuzz/known-issues.json.
import crypto from "node:crypto"

/**
 * Strip what changes between runs from a message: URLs, emails, UUIDs, long hex ids,
 * numbers (with either decimal separator), quoted user input and extra whitespace.
 */
export function normalizeMessage(message) {
  return String(message ?? "")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)]+/gi, "<url>")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "<email>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>")
    .replace(/\b(?=[0-9a-f]*\d)[0-9a-f]{12,}\b/gi, "<id>")
    .replace(/-?\d+([.,]\d+)*/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300)
}

/**
 * A URL or path as a route pattern: no origin, query or hash; numeric, email and id
 * segments replaced (`/session/12` → `/session/<n>`, `/friends/a%40b.c` → `/friends/<email>`).
 */
export function routePattern(urlOrPath) {
  let pathname = String(urlOrPath ?? "")
  try {
    pathname = new URL(pathname, "http://x.invalid").pathname
  } catch {
    // Not parseable: keep the raw string.
  }
  const segments = pathname.split("/").map((seg) => {
    let s = seg
    try {
      s = decodeURIComponent(seg)
    } catch {
      // Malformed escape: keep it as is.
    }
    if (/^\d+$/.test(s)) return "<n>"
    if (/^[^@\s]+@[^@\s]+$/.test(s)) return "<email>"
    if (/^[0-9a-f-]{16,}$/i.test(s)) return "<id>"
    return seg
  })
  const p = segments.join("/") || "/"
  return p.length > 1 ? p.replace(/\/$/, "") : p
}

/** 12 hex chars of sha1(kind | route pattern | normalized message). */
export function findingSignature({ kind, route, message }) {
  const basis = `${kind}|${routePattern(route)}|${normalizeMessage(message)}`
  return crypto.createHash("sha1").update(basis).digest("hex").slice(0, 12)
}
