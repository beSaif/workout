# Session detail

Session detail shows one logged session on its own page: its number, training day, date, bodyweight, best e1RM, the main lift's warm-up and working sets (kg, reps, RPE, e1RM), accessories and the session note. It is read-only; editing happens from the Home card (see `edit-unlog-session`).

## Sub-features

- `detail-open` opens the page from a logged session's card via `Details`.
- `detail-content` shows header, working weight, set count, set table, accessories and note matching what was saved.
- `detail-from-api` refills from the API when the device copy is gone.
- `detail-missing` shows `Session not found.` for an unknown id.

## How to get to it (user POV)

- On Home, tap a card under `Logged this block`, then `Details`.
- In History, tap an archived card, then `Details`.
- Open `/session/<id>` directly.

## Driving it with Playwright (verify.mjs)

Preconditions:

- Signed in with the onboarded bench profile (`signIn()`), nothing logged yet.
- `verify.mjs doctor` is green for the target.

- **Log a session.** Choose `Log Session` and finish the logger (`completeOpenLogger`). `POST /api/sessions` carries one confirmed session.
- **Open details.** Choose `getByRole("button", { name: /^Session 1 ·/ })`, then `getByRole("link", { name: "Details" })`. The URL is `/session/<id>`.
- **Check content.** `heading level 1 /^Session 01 · /`, text `Bench Press`, `e1RM`, the first working set's `<kg>kg`, and the note are visible.
- **Second view.** Remove `lift-tracker-sessions` and `lift-tracker-blocks` from localStorage and reload. The same heading and note return, after a new `GET /api/sessions`.
- **Missing id.** Go to `/session/999`. `Session not found.` and a `Back to home` link to `/` appear.
- **Run.** `node .claude/skills/verify-workout/verify.mjs run --feature session-detail`
- **Proof.** `session-detail/01-action-card-expanded-details.png`, `02-result-session-detail.png`, `03-result-session-detail-from-api.png`, `video.webm`, `api-calls.json`.

## Gotchas

- Home numbers sessions within the block (`Session 1 · 25 Nov`); the detail page and History use the padded global id (`Session 01`).
- The page has no edit or delete controls; do not report editing as verified here.
- A single's set row reads `1 reps` (app copy), so match on kg, not on the reps text.
