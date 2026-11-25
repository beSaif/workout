# Edit or unlog a logged session

A logged session's card on Home expands into actions: `Edit` reopens it in an editor where sets, accessories and the note can be changed and saved, and `Unlog` (after a confirmation) removes it from history and rewinds the block so it comes up next again.

## Sub-features

- `card-expand` expands a logged card to show `Details`, `Share`, `Edit`, `Unlog`.
- `edit-save` edits sets and the note in `Edit Session NN` and saves them.
- `unlog-confirm` asks `Unlog Session NN?` and removes the session on `Unlog`.
- `unlog-rewind` brings the unlogged slot back as the up-next session.

## How to get to it (user POV)

- On Home, tap a card under `Logged this block` and choose `Edit` or `Unlog`.

## Driving it with Playwright (verify.mjs)

Preconditions:

- Signed in with the onboarded bench profile, one session logged through `Log Session` in the same journey.

- **Open editor.** Choose `getByRole("button", { name: /^Session 1 ·/ })`, then `Edit`. A dialog with heading `Edit Session 01` appears.
- **Edit.** In the editor, choose the `Delete` button of the last bench set (the N-th `Delete`, N = bench sets saved) and fill placeholder `How did it feel?` with `after edit`. Choose `Save Changes`. The editor closes.
- **Edit saved.** The last `POST /api/sessions` has the same session id, note `after edit` and one bench set fewer. The card shows the shorter set summary.
- **Unlog.** Expand the card, choose `Unlog`. `alertdialog "Unlog Session 01?"` appears; choose its `Unlog`.
- **Unlog saved.** The last `POST /api/sessions` and localStorage `lift-tracker-sessions` hold no confirmed session; `Logged this block` is gone and `Up next` shows again.
- **Run.** `node .claude/skills/verify-workout/verify.mjs run --feature edit-unlog-session`
- **Proof.** `edit-unlog-session/01-action-edit-session-open.png`, `02-result-home-after-edit.png`, `03-action-unlog-confirm.png`, `04-result-home-after-unlog.png`, `edited-session.json`, `api-calls.json`, `video.webm`.

## Gotchas

- Accessory sets in the editor also have `Delete` buttons, after the bench sets; `.last()` deletes an accessory set, not a bench set.
- The bench lift itself has no `Remove` button (only other main lifts do).
- The card stays expanded after an edit; check `Unlog` is visible before clicking the card again, or the click collapses it.
