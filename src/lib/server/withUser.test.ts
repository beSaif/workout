import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const auth = vi.hoisted(() => vi.fn())
vi.mock("@/auth", () => ({ auth }))

import { withUser, type UserRouteContext } from "./withUser"

function call<P extends Record<string, string>>(
  route: ReturnType<typeof withUser<P>>,
  params: P
): Promise<Response> {
  return route(new NextRequest("http://localhost/api/test"), { params: Promise.resolve(params) })
}

beforeEach(() => auth.mockReset())

describe("withUser", () => {
  it.each([null, {}, { user: {} }, { user: { name: "No Email", email: null } }])(
    "answers 401 { error: 'unauthorized' } without a signed-in email (%j)",
    async (session) => {
      auth.mockResolvedValue(session)
      const handler = vi.fn()
      const res = await call(withUser(handler), {})

      expect(res.status).toBe(401)
      expect(res.headers.get("content-type")).toContain("application/json")
      expect(await res.text()).toBe('{"error":"unauthorized"}')
      expect(handler).not.toHaveBeenCalled()
    }
  )

  it("calls the handler with the email, user, request and params", async () => {
    const user = { name: "Ann", email: "Ann@Example.com" }
    auth.mockResolvedValue({ user, expires: "2099-01-01T00:00:00.000Z" })
    const handler = vi.fn<(ctx: UserRouteContext<{ id: string }>) => Promise<Response>>(async () =>
      Response.json({ ok: true })
    )

    const res = await call(withUser<{ id: string }>(handler), { id: "42" })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(handler).toHaveBeenCalledTimes(1)
    const ctx = handler.mock.calls[0][0]
    expect(ctx.email).toBe("Ann@Example.com")
    expect(ctx.user).toEqual(user)
    expect(ctx.request).toBeInstanceOf(NextRequest)
    expect(await ctx.params).toEqual({ id: "42" })
  })
})
