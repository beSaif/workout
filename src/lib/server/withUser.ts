import "server-only"
import type { User } from "next-auth"
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"

type RouteParams = Record<string, string | string[] | undefined>

export interface UserRouteContext<P extends RouteParams> {
  /** The signed-in user's email, as the session has it (not lowercased). */
  email: string
  user: User
  request: NextRequest
  /** The dynamic route params, as Next passes them: a promise. Await it in `[segment]` routes. */
  params: Promise<P>
}

/**
 * Wrap a route handler that needs a signed-in user. Answers 401 `{ error: "unauthorized" }`
 * without calling the handler when there is none — the body every route has always sent.
 *
 *   export const GET = withUser(async ({ email }) => NextResponse.json(...))
 *   export const GET = withUser<{ id: string }>(async ({ params }) => { const { id } = await params })
 */
export function withUser<P extends RouteParams = Record<string, never>>(
  handler: (ctx: UserRouteContext<P>) => Promise<Response>
): (request: NextRequest, context: { params: Promise<P> }) => Promise<Response> {
  return async (request, context) => {
    const session = await auth()
    const user = session?.user
    const email = user?.email
    if (!user || !email) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    return handler({ email, user, request, params: context.params })
  }
}
