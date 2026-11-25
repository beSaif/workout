# Cycle report

When the deload that closes a cycle is logged (or jumped past), a report opens: the peak outcome and test single, best e1RM, sessions and sets by phase, how the sessions felt against target, and a setup for the next cycle (peak: Ease off / Suggested / Push or any value, days a week, length). Starting it sets up the new Volume block; the finished cycle's report stays readable from Manage.

## Sub-features

- `report-open` opens `Cycle N complete` after the last deload session is logged.
- `report-content` shows the headline, `Best e1RM`, `Sessions` (with skipped count), `By phase`, `How it felt`.
- `report-start` starts cycle N+1 with the chosen peak, days a week and length.
- `report-later` closes with `Later`; until the new cycle's first session, the peak pill reopens the setup report.
- `report-past` shows the finished cycle's report read-only from Manage → `Cycle N report`.

## How to get to it (user POV)

- Log the cycle's deload session (or jump past it onto the next cycle's first session).
- Home → peak pill before the new cycle's first session.
- Home → peak pill → `Cycle N report` once the new cycle has a session.

## Driving it with Playwright (verify.mjs)

Preconditions:

- Signed in with the onboarded bench profile, nothing logged (cycle 1, peak 80kg).

- **Jump to the deload.** Choose `Deload 1 session` on the timeline, then `getByRole("button", { name: /^Session 1 .*Jump$/ })`; confirm `alertdialog /^Jump to Deload/` with `Jump`. `Jumped to Deload …` appears.
- **Log the deload.** `Log Session` through the logger. A dialog with `Cycle 1 complete`, `By phase` and `Set up cycle 2` opens by itself.
- **Set up cycle 2.** Choose the `… Push` peak option, `4`, `Long`, then `Start cycle 2 · peak <push>kg`. The report closes.
- **Started.** The saved active block is `accumulation` with `anchorWeight` = push, `sessionsPerWeek: 4`, `cycleLength: "long"`, `setUp: true`, `sessionIds: []`; a completed deload block exists; the pill reads `This cycle peaks at <push>kg · Manage`.
- **Reopen and Later.** Choose the pill: the setup report (`Set up cycle 2`) opens again; choose `Later`.
- **Past report.** Log cycle 2's first session, choose the pill, then `Cycle 1 report`. `Cycle 1 complete` opens without `Set up cycle 2`.
- **Run.** `node .claude/skills/verify-workout/verify.mjs run --feature cycle-report`
- **Proof.** `cycle-report/02-result-cycle-report.png`, `04-result-cycle-2-home.png`, `05-result-past-report-read-only.png`, `blocks-after-start.json`, `api-calls.json`, `video.webm`.

## Gotchas

- Jumping over Volume, Intensity and Peak makes the report say `Peak single skipped` / `Peak stays 80kg` with 18 skipped sessions; a full cycle's report needs 19 logged sessions or a seeded cycle.
- The suggested peak depends on the logged results, so read the `Push` option's kg from the button instead of hardcoding it.
- The report only opens when the jump or log closes the deload; jumping to the deload alone does not.
