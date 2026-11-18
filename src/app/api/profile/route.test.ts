import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const auth = vi.hoisted(() => vi.fn())
vi.mock("@/auth", () => ({ auth }))

// Every KV call fails, as it does when the store is down or unreachable.
const kvDown = vi.hoisted(() => () => Promise.reject(new Error("KV unavailable")))
vi.mock("@/lib/server/db", () => ({
  readProfile: vi.fn(kvDown),
  readProfiles: vi.fn(kvDown),
  writeProfile: vi.fn(kvDown),
  readLegacySessionsDoc: vi.fn(kvDown),
  copySessionsDoc: vi.fn(kvDown),
  writeSessionsDoc: vi.fn(kvDown),
  store: new Proxy({}, { get: () => vi.fn(kvDown) }),
}))

import { POST } from "./route"

const params = { params: Promise.resolve({}) }

beforeEach(() => {
  auth.mockReset()
  auth.mockResolvedValue({ user: { name: "Ann", email: "ann@example.com" }, expires: "2099-01-01T00:00:00.000Z" })
})

describe("POST /api/profile", () => {
  it("answers a JSON 503 when the existing profile can't be read", async () => {
    const request = new NextRequest("http://localhost/api/profile", {
      method: "POST",
      body: JSON.stringify({ name: "Ann", bw: 70, trainingMode: "lift-focused", mainLift: "bench", anchor: 60, target: 100 }),
    })
    const res = await POST(request, params)

    expect(res.status).toBe(503)
    expect(res.headers.get("content-type")).toContain("application/json")
    expect(await res.json()).toEqual({ error: "KV read failed" })
  })
})
