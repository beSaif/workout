# Workout verification map

This directory is the maintained source for verifying the user-facing behavior of Workout. Read this index before driving the app, then use the matching feature file as the recipe. Each feature has exactly one journey, `../journeys/<id>.journey.ts`, tagged `@<id>`.

## Baseline preconditions

- A target that passes `node .claude/skills/verify-workout/verify.mjs doctor`: the local server from `verify.mjs launch` (`http://localhost:3210`, throwaway secrets, unroutable KV), or a deployed preview with `BASE_URL`, `E2E_AUTH_SECRET` (= its `AUTH_SECRET`) and `VERCEL_AUTOMATION_BYPASS_SECRET`. Never production.
- Every journey runs in a fresh browser context with its own in-memory `FakeApi`: an empty account, no sessions, no friends, no weigh-ins, nothing in localStorage. There is no shared seed data to restore.
- `signIn()` forges an Auth.js session for `E2E Smoke <e2e-smoke@example.invalid>` and seeds an onboarded Main Lift profile: bench, 80 kg bodyweight, 80 kg 1RM anchor (cycle peak), 100 kg target, weekly weigh-in answered "no", install guide and What's new already dismissed. Journeys that need another state seed it themselves with `api.seed(...)` or an init script, and say so under `Preconditions:`.
- Never drive an instance this run did not start or doctor.

## Driving conventions

- Prefer ARIA roles and accessible names (`getByRole("button", { name: "Log Session", exact: true })`), then visible text, then route paths. No CSS selectors or coordinates; the few placeholder-based handles are called out in their feature's Gotchas.
- The nav drawer is a `dialog` that stays in the DOM off-screen. Scope dialogs by their title (`getByRole("dialog").filter({ hasText: /Log Session \d+/ })`), never `getByRole("dialog")` alone.
- `/api/**` (except `/api/auth/**`) is answered in the browser by the fake. Seed responses with `api.seed(path, body)` before `page.goto`. For a write the fake doesn't model, use `answer(api, method, path, json)` from `harness.ts`. Never use `page.route` for `/api` data paths, because `apiGuard` counts those as leaks.
- Cross-origin requests (Google OAuth, push services) are aborted and listed in `externalRequests`. After a blocked cross-origin navigation the tab sits on a browser error page; go back to the app's origin before reading localStorage or asserting UI.
- Wait for states (a button, a dialog, `expect.poll` on `api.calls`), never fixed sleeps.
- Multi-session states (a finished cycle, archived history, a layoff) are reached through the UI where practical (Jump, logging, the browser clock) and otherwise seeded with sessions and blocks shaped like `src/lib/types.ts`.

## Proof and skip reporting

- Capture the user action (`evidence.shot(page, "action", ...)`) and the resulting state (`"result"`), not only the final screen. Every journey also leaves `video.webm`, `api-calls.json` and `local-storage.json`.
- Mutation proof is the request body the UI sent (on the fake) plus a second read of the stored value: localStorage, a reload, or another screen that shows it.
- Every journey ends with `expect(pageErrors).toEqual([])`.
- `summary.md` records the feature id, pass/fail, target URL, git SHA and every artifact path. Attach it to the PR.
- A precondition the target cannot meet makes the journey fail with the reason, and the reason goes in that feature's Gotchas. Never weaken a journey to pass, and never report an entry point as verified through a different one. Sub-features a journey does not drive are listed as such in its feature file.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with Playwright (verify.mjs)` starts with `Preconditions:` and uses labeled bullets that pair each user action with a locator and an observable result, a **Run.** bullet and a **Proof.** bullet.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state and observable proof.

## Features

Getting in

- [Signed-out welcome](./signed-out-welcome.md) (`signed-out-welcome`): redirect to `/welcome`, get started, and the Google sign-in attempt (aborted, asserted).
- [Onboarding](./onboarding.md) (`onboarding`): the new-user questionnaire through to a saved profile and Home.
- [Install as an app (PWA)](./pwa-install.md) (`pwa-install`): manifest, icons, service worker, and the add-to-home-screen guide.

Main Lift training

- [Home dashboard](./home-dashboard.md) (`home-dashboard`): e1RM progress card, phase timeline and previews, peak pill, greeting → Profile.
- [Log a session](./log-session.md) (`log-session`): the logger, main lift first, minimize and resume, presence, confirm and save.
- [Skip the main lift](./skip-main-lift.md) (`skip-main-lift`): "Skip Bench" logs accessories only and carries the load forward.
- [Jump to a later session](./jump-to-session.md) (`jump-to-session`): jump ahead in the block, skipped slots, undo.
- [Training day and extras](./training-day-extras.md) (`training-day-extras`): Coach pick, Switch day and + Extras on the up-next card.
- [Edit or unlog a session](./edit-unlog-session.md) (`edit-unlog-session`): edit a logged session in the logger, unlog it.
- [Session detail](./session-detail.md) (`session-detail`): the `/session/<id>` page and its not-found state.
- [Share a session as an image](./share-session.md) (`share-session`): share card preview, share sheet and save.
- [Manage the cycle](./manage-cycle.md) (`manage-cycle`): change the peak and restart the cycle.
- [Cycle report](./cycle-report.md) (`cycle-report`): end-of-cycle review and setting up the next cycle.
- [Layoff banner](./layoff-banner.md) (`layoff-banner`): time-off warnings, keep going, restart the block.
- [History](./history.md) (`history`): archived sessions from finished cycles.

Balanced training and the routine

- [Balanced mode](./balanced-mode.md) (`balanced-mode`): switching focus, the Balanced home and logging a training day.
- [Routine editor](./routine-editor.md) (`routine-editor`): training days, muscle groups and exercises on `/exercises`.
- [Plan with Dot](./plan-with-dot.md) (`plan-with-dot`): the LLM planner and "Use your own AI", preview, apply, undo.

Body and account

- [Bodyweight](./weight.md) (`weight`): weigh-in opt-in and check-in, `/weight` chart ranges, goal, delete.
- [Profile settings](./profile-settings.md) (`profile-settings`): edit profile fields, weekly check-in, delete account.
- [Menu, Dot and sign out](./nav-drawer.md) (`nav-drawer`): menu links, Show Dot and Haptics switches, sign out.
- [What's new](./whats-new.md) (`whats-new`): the release-notes sheet and its seen marker.
- [Push notifications](./notifications.md) (`notifications`): the enable banner and push subscription (push service faked).

Gymbros

- [Gymbros](./gymbros.md) (`gymbros`): search, invite by email, accept and reject requests, remove.
- [Friend profile](./friend-profile.md) (`friend-profile`): a friend's card, hype, their routine, train under them.
- [Gymbro messages](./messages.md) (`messages`): unread badge, replies, roasts, the inbox and the hype panel.
- [My card](./my-card.md) (`my-card`): your own card as gymbros see it, and the share card.

## Not mapped

- `/dev` developer tools: only the `LEGACY_OWNER_EMAIL` account can open it in production (reached by long-pressing the greeting); not a user feature.
- `/api/cron/reminders` and `?preview=1`: a Vercel cron job that reads stored data on the server (KV); a browser fake can't stand in for it, and no journey may reach KV.
- Real Google OAuth, real KV persistence, real Web Push delivery and the real LLM planner: external boundaries that journeys fake or abort by design.
