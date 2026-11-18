import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const auth = vi.hoisted(() => vi.fn())
vi.mock("@/auth", () => ({ auth }))

// Every KV call fails, as it does when the store is down or unreachable.
const kvDown = vi.hoisted(() => () => Promise.reject(new Error("KV unavailable")))
vi.mock("@/lib/server/db", () => ({
  readProfile: vi.fn(kvDown),
  readProfiles: vi.fn(kvDown),
  readValidSessionsDoc: vi.fn(kvDown),
  store: new Proxy({}, { get: () => vi.fn(kvDown) }),
}))

import { GET } from "./route"

const params = { params: Promise.resolve({}) }

beforeEach(() => {
  auth.mockReset()
  auth.mockResolvedValue({ user: { name: "Ann", email: "ann@example.com" }, expires: "2099-01-01T00:00:00.000Z" })
})

describe("GET /api/friends/profile", () => {
  it.each(["http://localhost/api/friends/profile", "http://localhost/api/friends/profile?email=bob%40example.com"])(
    "answers a JSON 503 when KV fails (%s)",
    async (url) => {
      const res = await GET(new NextRequest(url), params)

      expect(res.status).toBe(503)
      expect(res.headers.get("content-type")).toContain("application/json")
      expect(await res.json()).toEqual({ error: "KV read failed" })
    }
  )
})
