# Jump to a later session

Feeling strong, a user taps a later session in the block view to make it the up-next session. The sessions in between are marked skipped (not trained), the load may jump, and an undo banner can put the program back.

## Sub-features

- `jump-preview` shows a "Jump" chip on every later session of the current block and on the upcoming phases' previews.
- `jump-confirm` asks "Jump to <phase> <n>?" with the new prescription, how many sessions are skipped and the load change.
- `jump-apply` makes that session up next, lists the skipped ones, and shows "Jumped to <phase> <n>" with "Undo".
- `jump-undo` restores the previous up-next session and blocks.
- `jump-cycle-report` jumping past a deload onto the next cycle opens the cycle report (see `manage-cycle`; not driven here).

## How to get to it (user POV)

- Home → block view → tap a later "Session N … Jump" row.
- Home → tap an upcoming phase in the timeline → tap one of its sessions.

## Driving it with Playwright (verify.mjs)

Preconditions:

- Doctor passes. `signIn()` profile, no sessions: up next is Session 1 at 70kg.

- **Pick.** `getByRole("button", { name: /^Session 4 Heavy Single .*Jump$/ })` shows 72.5kg; click it.
- **Confirm.** `getByRole("alertdialog", { name: /^Jump to / })` says "3 sessions in between are skipped and won't count as trained." and "That's +2.5kg on today's 70kg."; click its `Jump` button.
- **Applied.** "Session 4" is up next at 72.5kg, "Jumped to Volume 4" shows with "Undo", and "Skipped · Session 1, 2, 3" is listed. The next `POST /api/sessions` has no confirmed session, three `skippedSlots` across its blocks, and an unconfirmed session whose first working set is 72.5kg; `lift-tracker-blocks` agrees.
- **Undo.** Click `getByRole("button", { name: "Undo", exact: true })`. "Session 1" at 70kg is back and the saved blocks have no skipped slots.
- **Run.** `node .claude/skills/verify-workout/verify.mjs run --feature jump-to-session`
- **Proof.** `jump-to-session/` holds `01-action-confirm-jump-to-session-4.png`, `02-result-up-next-session-4.png`, `03-result-after-undo-session-1.png`, `saved-after-jump.json`, `api-calls.json`, `local-storage.json` and `video.webm`.

## Gotchas

- `getByText("72.5kg")` also matches the Session 7 preview; the up-next weight is the first match.
- The confirm sheet's title is not a heading; read the slot label from the dialog's accessible name or text.
- Undo only exists until the program changes again (logging or another jump clears it).
