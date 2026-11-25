# Home dashboard (Main Lift mode)

Home shows where the main lift stands against the goal, the cycle's phase timeline with its peak, the up-next session with its prescription, previews of the rest of the block, and the sessions logged this block.

## Sub-features

- `home-greeting` greets the user; a short tap opens `/profile` (a long press opens owner-only dev tools).
- `home-progress-card` shows e1RM (Brzycki) against the goal as a meter, best lift, bodyweight and session count.
- `home-timeline` lists Volume, Intensity, Peak and Deload with progress; tapping an upcoming phase previews its sessions with a "Back to <phase>" button.
- `home-peak-pill` "This cycle peaks at <kg> · Manage" opens the cycle sheet (see `manage-cycle`).
- `home-up-next` shows the next session's load, reps, back-offs and intent, with "Log Session" and "Skip Bench".
- `home-block-previews` lists the remaining sessions of the block, each with "Jump" (see `jump-to-session`).
- `home-logged` lists "Logged this block" once a session is confirmed.

## How to get to it (user POV)

- Open the app signed in with a finished onboarding; Home is `/`.
- Menu → "Home", or the back arrow on any page.

## Driving it with Playwright (verify.mjs)

Preconditions:

- Doctor passes. `signIn()` seeds a lift-focused bench profile (1RM 80kg, goal 100kg) and no sessions.

- **Fresh block.** `page.goto("/")`. `getByRole("meter", { name: "e1RM against the 100kg goal" })` has `aria-valuenow="0"`; buttons "Volume 0/9", "Intensity 6 sessions", "Peak 3 sessions", "Deload 1 session" and "This cycle peaks at 80kg · Manage" are visible; "Up next" shows; eight `getByRole("button", { name: /^Session \d+ .*Jump$/ })` previews.
- **Preview a phase.** Click "Peak 3 sessions". `getByRole("button", { name: /Back to Volume/ })` appears, three previews show with a "Peak single", and "Up next" is gone. Click back: "Up next" returns.
- **Peak pill.** Click "This cycle peaks at 80kg · Manage". A dialog "This cycle" with "Change peak" opens; Escape closes it.
- **Log and refresh.** Log the up-next session (`logUpNextSession` from `e2e/flows.ts`). The meter's `aria-valuenow` equals the best Brzycki e1RM of the saved working sets, "<kg> × <reps>" best lift shows, the timeline reads "Volume 1/9", "Logged this block" lists the session and "Session 2" is up next.
- **Profile shortcut.** Click `getByRole("button", { name: "Open profile" })`. URL is `/profile` with heading "Profile".
- **Run.** `node .claude/skills/verify-workout/verify.mjs run --feature home-dashboard`
- **Proof.** `home-dashboard/` holds `01-result-home-fresh-block.png`, `02-action-preview-peak-phase.png`, `03-action-peak-pill-manage-open.png`, `04-result-home-after-logging.png`, `05-result-profile-from-greeting.png`, `expected-progress.json` (independently computed e1RM/best lift), `api-calls.json`, `local-storage.json` and `video.webm`.

## Gotchas

- The greeting is a pointer-driven button: a press held 800ms navigates to `/dev` instead of `/profile`. Use a plain click.
- Expected numbers come from the seeded profile (80kg peak, 100kg goal, standard cycle). Changing `onboardedProfile()` in `e2e/fixtures.ts` changes every label asserted here.
- The menu drawer is always in the DOM as a hidden dialog; scope dialog locators by their text.
- The Volume count and preview count assume three sessions a week at standard length (9 + 6 + 3 + 1).
