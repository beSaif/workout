# Share a session as an image

Share turns a logged session into a 1080px PNG card (lift, top set, e1RM, goal, bodyweight, cycle progress) shown full-screen, with `share` (OS share sheet), `save` (download) and `copy` (clipboard) actions.

## Sub-features

- `share-open` opens `share your lift` from a logged card's `Share`.
- `share-preview` builds the card image (`img "Workout share card"`, 1080px wide).
- `share-os` hands the PNG to the OS share sheet when the browser can share files.
- `share-save` downloads `<lift>-<YYYY-MM-DD>.png` and shows `saved`.
- `share-close` closes back to where it was opened.

## How to get to it (user POV)

- Home → a card under `Logged this block` → `Share`.
- History → an archived card → `Share`.

## Driving it with Playwright (verify.mjs)

Preconditions:

- Signed in with the onboarded bench profile; one session logged in the journey.
- `navigator.share`/`canShare` are replaced by an init script that records the files instead of opening a share sheet.

- **Open.** Choose `/^Session 1 ·/`, then `Share`. A dialog with `share your lift` appears.
- **Preview.** `img "Workout share card"` becomes visible (allow 30s) with `naturalWidth` 1080.
- **Share.** Choose `share`. The stub records one file `bench-<date>.png`, `image/png`, title `best workout tracker`.
- **Save.** Choose `save`. A download named `bench-<date>.png` arrives and `saved` shows.
- **Close.** Choose `close`. The sheet is gone and no non-GET `/api` call was made by sharing.
- **Run.** `node .claude/skills/verify-workout/verify.mjs run --feature share-session`
- **Proof.** `share-session/01-result-share-preview.png`, `share-card-download.png` (the actual image), `02-action-saved-toast.png`, `api-calls.json`, `video.webm`.

## Gotchas

- `share` and `copy` only render when the browser supports them; headless Chromium has no file sharing, hence the stub. Never let a journey reach a real share target.
- The preview fades in; wait for its animation before screenshotting or the card looks dimmed.
- The file name uses the session's UTC date, which can differ from the card's local date around midnight.
