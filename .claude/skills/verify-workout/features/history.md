# History

History lists the sessions of finished cycles (newest first) as expandable cards with `Details` and `Share`, and points to Home for sessions of the cycle in progress.

## Sub-features

- `history-archive` lists every session of finished cycles, newest first, with the count `N archived sessions`.
- `history-current-link` shows `N session(s) from your current cycle is/are on Home` linking to `/`.
- `history-open` expands an archived card and opens its `Details`.
- `history-empty` says `Nothing archived yet…` before any cycle has finished.

## How to get to it (user POV)

- Home → `Open menu` → `History`.
- Open `/history` directly.

## Driving it with Playwright (verify.mjs)

Preconditions:

- Signed in; the fake API is seeded (`api.seed("/api/sessions", { sessions, blocks })`) with a finished cycle (Volume, Intensity, Peak, Deload blocks, one confirmed session each) and an active Volume block holding one session from the last day.

- **Navigate.** Choose `Open menu`, then the `History` link in `dialog "Menu"`. The URL is `/history` with `heading level 1 "History"`.
- **Archive.** `4 archived sessions` is visible; the main region has four `/^Session \d+ ·/` cards, the first `Session 04`, the last `Session 01`.
- **Current-cycle link.** `link /1 session from your current cycle is on Home/` is visible.
- **Open one.** Choose `/^Session 0?3 ·/`, then `Details`. `/session/3` shows `Session 03 · …` and its note.
- **Go Home.** Back on `/history`, choose the current-cycle link. Home shows `Logged this block` with the cycle-2 session.
- **Side effect.** Data came from `GET /api/sessions`; any `POST /api/sessions` made while viewing still holds all five confirmed sessions.
- **Run.** `node .claude/skills/verify-workout/verify.mjs run --feature history`
- **Proof.** `history/01-result-history-archive.png`, `03-result-archived-session-detail.png`, `04-result-home-current-cycle.png`, `api-calls.json`, `video.webm`.

## Gotchas

- Reaching a real archive through the UI takes a whole cycle (19+ sessions), so the journey seeds one; the seeded blocks need `schemeVersion: 3` or the app re-plans them on load.
- History labels use the padded global id (`Session 04`); Home numbers within the block (the cycle-2 session shows as `Session 1`).
- With nothing archived the page shows only the empty message, which looks like a failure but is not.
