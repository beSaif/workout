import { describe, expect, it } from "vitest"
import { isBackgroundRequest, isSessionRefresh, setCookiesFor } from "../sessionCookie"

const h = (entries: Record<string, string>) => new Headers(entries)

const REFRESH = "authjs.session-token=eyJhbGciOiJkaXIifQ..abc; Path=/; Expires=Fri, 25 Dec 2099 12:00:00 GMT; HttpOnly; SameSite=Lax"
const SECURE_REFRESH = "__Secure-authjs.session-token=eyJ.x.y; Path=/; Expires=Fri, 25 Dec 2099 12:00:00 GMT; HttpOnly; Secure; SameSite=Lax"
const CHUNK = "authjs.session-token.1=part; Path=/; Max-Age=2592000; HttpOnly"
const CLEAR = "authjs.session-token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax"
const CLEAR_MAX_AGE = "__Secure-authjs.session-token=deleted; Path=/; Max-Age=0; Secure"
const CSRF = "authjs.csrf-token=abc%7Cdef; Path=/; HttpOnly; SameSite=Lax"
const CALLBACK = "authjs.callback-url=http%3A%2F%2Flocalhost; Path=/; HttpOnly; SameSite=Lax"

describe("isBackgroundRequest", () => {
  it("treats fetch(), RSC fetches/prefetches (Sec-Fetch-Dest: empty), XHR and assets as background", () => {
    for (const dest of ["empty", "script", "image", "style", "font"]) expect(isBackgroundRequest(h({ "sec-fetch-dest": dest }))).toBe(true)
  })

  it("treats page loads, and requests without these headers, as page loads", () => {
    expect(isBackgroundRequest(h({ "sec-fetch-dest": "document" }))).toBe(false)
    expect(isBackgroundRequest(h({ "sec-fetch-dest": "iframe" }))).toBe(false)
    expect(isBackgroundRequest(h({}))).toBe(false)
    // Next strips its own RSC headers before the proxy runs; they decide nothing here.
    expect(isBackgroundRequest(h({ rsc: "1", "next-router-prefetch": "1" }))).toBe(false)
  })
})

describe("isSessionRefresh", () => {
  it("matches a session cookie being set, chunked or not, http or https", () => {
    expect(isSessionRefresh(REFRESH)).toBe(true)
    expect(isSessionRefresh(SECURE_REFRESH)).toBe(true)
    expect(isSessionRefresh(CHUNK)).toBe(true)
  })

  it("never matches a session cookie being cleared", () => {
    expect(isSessionRefresh(CLEAR)).toBe(false)
    expect(isSessionRefresh(CLEAR_MAX_AGE)).toBe(false)
  })

  it("never matches other cookies", () => {
    expect(isSessionRefresh(CSRF)).toBe(false)
    expect(isSessionRefresh(CALLBACK)).toBe(false)
    expect(isSessionRefresh("garbage")).toBe(false)
  })
})

describe("setCookiesFor", () => {
  const all = [CSRF, CALLBACK, REFRESH]

  it("keeps every cookie on a page load: the session is extended exactly as before", () => {
    expect(setCookiesFor(h({ "sec-fetch-dest": "document" }), all)).toEqual(all)
    expect(setCookiesFor(h({}), all)).toEqual(all)
  })

  it("drops only the session refresh from a background response", () => {
    expect(setCookiesFor(h({ "sec-fetch-dest": "empty", "sec-fetch-mode": "cors" }), all)).toEqual([CSRF, CALLBACK])
    expect(setCookiesFor(h({ "sec-fetch-dest": "empty" }), [SECURE_REFRESH, CHUNK])).toEqual([])
  })

  it("lets a background response still clear the session", () => {
    expect(setCookiesFor(h({ "sec-fetch-dest": "empty" }), [CLEAR, CLEAR_MAX_AGE])).toEqual([CLEAR, CLEAR_MAX_AGE])
  })
})
