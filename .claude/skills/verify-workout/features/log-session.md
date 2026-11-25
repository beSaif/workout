# Log a session

Logging lets a user open the up-next session from Home, work through every prescribed set with the main lift first, minimize the logger mid-session and come back to it, add a note, and confirm; the session is saved and Home moves on to the next one.

## Sub-features

- `log-open` opens the logger for the up-next session with the main lift (Bench Press) as the first exercise.
- `log-presence` marks the user as lifting while the logger is open and clears it on confirm.
- `log-minimize` minimizes the logger into the mini player, keeping a draft of the sets done.
- `log-resume` reopens the logger from the mini player where it was left.
- `log-confirm` finishes every set, saves a note and confirms; the session is stored on the server and the device.
- `log-advance` shows the logged session under "Logged this block" with the next session up next.

## How to get to it (user POV)

- Home → up-next card → `Log Session` (Main Lift mode).
- Home → mini player bar `Return to session` while a session is minimized.
- Balanced mode uses the same logger from its up-next card (see `balanced-mode`).

## Driving it with Playwright (verify.mjs)

Preconditions:

- Target passes `verify.mjs doctor`; the journey signs in with the forged session and the fake API seeds an onboarded Main Lift (bench) profile with no sessions.

- **Open logger.** Choose `Log Session`. `getByRole("button", { name: "Log Session", exact: true })`. A dialog titled `Log Session 01` opens; its first card reads `Bench Press · Warm-up`. The fake records `POST /api/presence` with `{ inSession: true }`.
- **Minimize.** Choose `Done` once, then `Minimize`. `logger.getByRole("button", { name: "Minimize" })`. The dialog closes, a `Return to session` bar shows `Bench Press 1 / 24 sets`, and localStorage `lift-tracker-draft` holds one completed set.
- **Resume.** Choose `Return to session`. The same logger dialog is visible again.
- **Finish and confirm.** Choose `Skip rest` / `Done` until `Session complete` appears, fill `How did it feel?` with a note, choose `Confirm Session`. The dialog closes.
- **Server copy.** `api.lastPost("/api/sessions")` holds exactly one confirmed session whose `coachNote` is the note and which has working (non-warm-up) sets; `POST /api/presence` with `{ inSession: false }` follows.
- **Home state.** `Logged this block` and a card starting `Session 1` are visible; localStorage `lift-tracker-sessions` has one confirmed session.
- **Run.** `node .claude/skills/verify-workout/verify.mjs run --feature log-session`.
- **Proof.** `log-session/01-action-logger-open-bench-first.png`, `02-result-minimized-mini-player.png`, `03-result-home-logged-this-block.png`, `saved-session.json`, `api-calls.json`, `local-storage.json`, `video.webm`.

## Gotchas

- The nav drawer is also a `dialog` (hidden off-screen); pick the logger by its `Log Session N` title, never `getByRole("dialog")` alone.
- `Done` that finishes an exercise animates for a beat before the next card shows; poll for `Done`/`Skip rest`/`Confirm Session` instead of sleeping a fixed time.
- The first `POST /api/sessions` happens on Home load (an empty sync), so assert on the last POST's confirmed sessions, not on the first call.
- A draft younger than its max age makes `Log Session` offer to resume instead of starting fresh; journeys start from a clean context, so they never see that prompt.
