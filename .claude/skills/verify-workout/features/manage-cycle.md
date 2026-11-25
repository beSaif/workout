# Manage the cycle

The peak pill under the program timeline (`This cycle peaks at <kg>kg · Manage`) opens the cycle's options: change the peak every load is a percentage of, read the last finished cycle's report, and restart the cycle from Volume session 1 with a new peak, days a week and length.

## Sub-features

- `manage-open` opens the `This cycle` sheet from the peak pill.
- `change-peak` sets a new peak; the pill and the up-next loads follow it.
- `restart-offer` shows `Restart cycle` only once the cycle has a session logged or a phase behind it.
- `restart-cycle` restarts with a chosen peak (±2.5kg), days a week (2–6) and length (Short, Standard, Long); logged sessions stay in history but stop moving the plan.

## How to get to it (user POV)

- Home → `This cycle peaks at <kg>kg · Manage` → `Change peak` or `Restart cycle`.

## Driving it with Playwright (verify.mjs)

Preconditions:

- Signed in with the onboarded bench profile (peak 80kg, nothing logged); Session 1's single is 70kg.

- **Open Manage.** Choose `getByRole("button", { name: "This cycle peaks at 80kg · Manage" })`. `dialog "This cycle"` shows `Change peak … Peaks at 80kg` and no `Restart cycle`.
- **Change peak.** Choose `Change peak`, fill the dialog's `spinbutton` (`Set this cycle's peak`) with `100`, choose `Update peak`. The pill reads `This cycle peaks at 100kg · Manage`, the up-next single shows `87.5kg`, and the saved active block's `anchorWeight` is `100`.
- **Log a session.** `Log Session` through the logger. One confirmed session is saved.
- **Restart.** Open the pill again and choose `Restart cycle`. The sheet says the session stays in history. Choose `2.5kg less`, `4`, `Short`, then `Restart cycle · peak 97.5kg`.
- **Restart saved.** The pill reads `97.5kg`, the timeline shows `Volume 0/…`; the saved active block is `accumulation` with `sessionIds: []`, `sessionsPerWeek: 4`, `cycleLength: "short"`; the logged session is still confirmed with no `blockId`.
- **Run.** `node .claude/skills/verify-workout/verify.mjs run --feature manage-cycle`
- **Proof.** `manage-cycle/01-action-manage-sheet.png` … `05-result-restarted-cycle.png`, `blocks-after-restart.json`, `api-calls.json`, `video.webm`.

## Gotchas

- Before a new cycle's first session the pill opens that cycle's setup report instead of this sheet (see `cycle-report`).
- The `Last cycle report` row appears only after a cycle has finished.
- The restart sheet's day buttons are bare digits: use `{ name: "4", exact: true }` scoped to the sheet.
- The progress card's `peak` and goal labels overlap when the peak is close to the goal (cosmetic, seen at 97.5 vs 100).
