import type { NextFetchEvent, NextRequest } from "next/server"
import { auth } from "@/auth"
import { setCookiesFor } from "@/lib/sessionCookie"

// Auth.js's proxy, used inline as before (redirects and 401s come from
// `callbacks.authorized` in src/auth.ts). Its types only cover the wrapper form.
const authProxy = auth as unknown as (req: NextRequest, ev: NextFetchEvent) => Promise<Response>

/**
 * Auth.js re-issues the session cookie on every response it passes through. A background
 * response (prefetch, RSC fetch, fetch()) answered just after sign-out would set it again
 * and revive the session, so those keep every cookie except that refresh; page loads are
 * untouched. See src/lib/sessionCookie.ts.
 */
export default async function proxy(req: NextRequest, ev: NextFetchEvent): Promise<Response> {
  const res = await authProxy(req, ev)
  const all = res.headers.getSetCookie()
  const keep = setCookiesFor(req.headers, all)
  if (keep.length === all.length) return res
  res.headers.delete("set-cookie")
  for (const c of keep) res.headers.append("set-cookie", c)
  return res
}

export const config = {
  // sw.js is exempt alongside the manifest: the browser fetches both before anyone has
  // signed in, and a redirect to the sign-in page makes the service worker fail to
  // register ("script resource is behind a redirect"), which in turn makes the app
  // uninstallable.
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|manifest.webmanifest|apple-icon|icon|sw\\.js|.*\\.png$).*)"],
}
