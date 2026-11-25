# Skip the main lift

"Skip Bench" on the up-next card turns today's session into accessories only. It is logged outside the block, and the prescribed main-lift load stays on deck to open the next session. It is the only way a Main Lift session can be logged without the main lift.

## Sub-features

- `skip-confirm` asks "Skip Bench today?" and names the load that stays on deck.
- `skip-card` turns the card into "Accessories" with "Bench skipped today" and "Undo skip".
- `skip-log` logs the session with no main-lift sets, marked as a skipped main lift, outside the block.
- `skip-carry` keeps the next session on the same block slot and load.
- `skip-undo` puts the main lift back on the card before logging (mapped; see Gotchas).
- `skip-nudge` warns after two skips in a row that the main lift is first up today.

## How to get to it (user POV)

- Home → up-next card → "Skip Bench" (the label follows the main lift: "Skip Squat", "Skip Deadlift").

## Driving it with Playwright (verify.mjs)

Preconditions:

- Doctor passes. `signIn()` profile, no sessions: up next is Session 1, 70kg single then 57.5kg × 6 × 4.

- **Before.** `getByText(/^Session 1$/)`, `getByText("70kg", { exact: true })` and `getByText("then 57.5kg × 6 × 4")` are visible.
- **Skip.** Click `getByRole("button", { name: "Skip Bench" })`. `getByRole("alertdialog", { name: "Skip Bench today?" })` says the load "stays on deck and opens your next session"; click its "Skip Bench".
- **Card.** "Bench skipped today", "Accessories" and `getByRole("button", { name: "Undo skip" })` show; "Skip Bench" is gone. The next `POST /api/sessions` holds the unconfirmed session with `skippedMainLift: true`.
- **Log.** "Log Session" opens a logger with no "Bench Press"; finish it with `completeOpenLogger` (journeys/flows.ts).
- **Saved.** The confirmed session in `POST /api/sessions` has `skippedMainLift: true`, `type: "Free"`, no `blockId` and `sets: []`; localStorage `lift-tracker-sessions` agrees.
- **Carried.** Up next is again "Session 1" at 70kg then 57.5kg × 6 × 4 with "Skip Bench", and the timeline still reads "Volume 0/9".
- **Run.** `node .claude/skills/verify-workout/verify.mjs run --feature skip-main-lift`
- **Proof.** `skip-main-lift/` holds `01-action-confirm-skip-bench.png`, `02-result-card-bench-skipped.png`, `03-action-logger-accessories-only.png`, `04-result-load-carried-to-next-session.png`, `saved-session.json`, `api-calls.json`, `local-storage.json` and `video.webm`.

## Gotchas

- Accessory sets are not in `sets`; `sets: []` means no main-lift sets, not an empty workout.
- After logging, the coach pick moves to the next training day (Day A → Day B); assert on the main-lift load, not the day.
- "Undo skip" and the two-skips nudge are not driven by this journey.
