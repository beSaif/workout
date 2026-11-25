# Balanced mode

Balanced mode turns Workout into a general training log: there is no main lift, no block or e1RM card, and Home instead shows the next training day from the user's rotation, how balanced their training is across muscle groups, and their recent sessions. A user switches into it from the Routine page and logs training-day sessions through the same logger.

## Sub-features

- `balanced-switch` switches Training Focus from Lift-focused to Balanced and saves the profile at once.
- `balanced-home` shows the up-next training day (with its Coach pick badge, muscles and exercise list), the Muscle balance card and Recent sessions, and no main-lift card or Skip button.
- `balanced-log` logs the up-next day through the logger, opening on the day's first exercise with no main lift.
- `balanced-rotation` advances the up-next card to the next day and starts tracking muscle balance once a session is logged.

## How to get to it (user POV)

- Menu → Exercise Selection (`/exercises`, heading "Routine") → Training Focus → `Balanced`.
- Profile → Goal → "Lift-focused · change" link, which leads to the same Routine page.
- After switching, Home (`/`) is the Balanced home; `Start session` on the Up next card opens the logger.

## Driving it with Playwright (verify.mjs)

Preconditions:

- Signed in with the onboarded lift-focused bench profile (`signIn()`), default routine (Day A Back + Triceps, Day B Chest + Biceps, Day C Legs + Shoulders), no sessions.
- `verify.mjs doctor` is green for the target.

- **Switch focus.** On `/exercises` click `getByRole("button", { name: "Balanced", exact: true })`. It gets `aria-pressed="true"` and the fake records `POST /api/profile` with `trainingMode: "balanced"`.
- **Balanced home.** Click `getByRole("link", { name: "Back to home" })`. No `meter` named `e1RM against …`, no `Skip Bench` button; `Up next` text, `heading` level 2 `Day A`, text `Back + Triceps`, and a button starting `Muscle balance not tracked yet` are visible.
- **Open the logger.** Click `getByRole("button", { name: "Start session" })`. The dialog titled `Log Session 01` opens with `Lat Pulldown · set 1` in its progress group and no `Bench` text.
- **Log it.** Mark every set `Done` (skip rest), fill `How did it feel?`, click `Confirm Session` (`completeOpenLogger` in journeys/flows.ts). The last `POST /api/sessions` holds one confirmed session with `sets: []`, `selectedTrainingDayId: "day-a"`, `extraWorkouts` for `back` and `triceps` with 14 sets, first exercise `Lat Pulldown`.
- **Resulting Home.** `heading` `Day B` is up next, the "not tracked yet" balance button is gone, `Recent sessions` lists one row (`top 10kg × 10 — Lat Pulldown`, one `Show session actions` button).
- **Run.** `node .claude/skills/verify-workout/verify.mjs run --feature balanced-mode`
- **Proof.** `balanced-mode/01-action-training-focus-balanced.png`, `02-result-balanced-home-up-next-day-a.png`, `03-action-logger-day-a.png`, `04-result-home-after-balanced-session.png`, `saved-session.json`, `api-calls.json`, `local-storage.json`, `video.webm`.

## Gotchas

- Switching to Balanced saves immediately; switching back to Lift-focused asks for lift, 1RM and target only when the profile lacks them (the seeded profile has them, so it switches straight back).
- New exercises have no history, so the logger pre-fills 10 kg × 10; the journey asserts the set count and exercise names, not loads.
- The menu's link to the Routine page is labelled "Exercise Selection", while the page heading is "Routine".
- "Coach pick" on the Up next card is Dot's recommended day, not the "train under a friend" coach (that is the friend profile's feature).
