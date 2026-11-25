import type { BrowserContext } from "@playwright/test"
import { isDataApi } from "../../../../e2e/fixtures"
import { classifyRequest } from "./lib/classify.mjs"

/** A request the fuzz guard aborted: never sent, only recorded. */
export type BlockedRequest = { kind: string; method: string; url: string }

/**
 * The fuzz harness's write wall, on top of e2e/fixtures.ts (FakeApi answers /api data,
 * apiGuard reports leaks). Every other request of `context` is classified by
 * lib/classify.mjs: same-origin reads, Auth.js reads and sign-out continue; cross-origin
 * requests, server actions (Next-Action), form posts, any other same-origin write and, on
 * production, Auth.js sign-in POSTs are aborted and listed in the returned array.
 * `handleExternal: false` leaves cross-origin requests to another handler that aborts them.
 */
export async function installFuzzGuard(
  context: BrowserContext,
  origin: string,
  { production, handleExternal = true }: { production: boolean; handleExternal?: boolean },
): Promise<BlockedRequest[]> {
  const blocked: BlockedRequest[] = []
  // Data-API URLs are left to the fake's own route (installApiFake), so the two never overlap.
  await context.route(
    (url) => !isDataApi(url, origin),
    async (route) => {
      const req = route.request()
      const { action, kind } = classifyRequest({
        method: req.method(),
        url: req.url(),
        headers: req.headers(),
        origin,
        production,
        navigation: req.isNavigationRequest(),
      })
      // Journeys keep their own cross-origin handler (harness.ts `externalRequests`),
      // which aborts and lists them for the journey's assertions.
      if (kind === "external" && !handleExternal) return route.fallback()
      if (action === "abort") {
        blocked.push({ kind, method: req.method(), url: req.url() })
        await route.abort("blockedbyclient")
      } else {
        await route.fallback()
      }
    },
  )
  return blocked
}
