# What's new

What's new shows a returning user the release notes they have not seen on this device yet, once, on Home.

## Sub-features

- `whats-new-show` lists every release newer than the device's last-seen marker in one sheet (only the latest when the device has no marker).
- `whats-new-dismiss` records the newest release as seen on `Got it` (or Escape), so the sheet does not return.

## How to get to it (user POV)

- Open Home after an app update. It waits behind the add-to-home-screen guide.

## Driving it with Playwright (verify.mjs)

Preconditions:

- Signed in, plus an init script that sets localStorage `lift-tracker-whats-new-seen` to `13` on the first load only (`signIn()` marks everything seen on every load).

- **Show.** Open `/`. The dialog filtered by `What's new` lists `Restart a cycle` (release 15) and `Heavy, light, medium` (release 14).
- **Dismiss.** Click button `Got it`. The dialog closes and `lift-tracker-whats-new-seen` is at least `15`; no `/api` write was made for it.
- **Stays dismissed.** Menu → `History` → `Back to home`: Home shows `Log Session` and no What's new dialog.
- **Run.** `node .claude/skills/verify-workout/verify.mjs run --feature whats-new`
- **Proof.** `whats-new/01-action-whats-new-modal.png`, `02-result-home-after-dismiss.png`, `video.webm`, `local-storage.json`.

## Gotchas

- The marker is per device; there is nothing server-side to check.
- A reload re-runs `signIn()`'s init script (seen = 999999); prove persistence with in-app navigation, not a reload.
- Adding a release changes the newest version and its title; update the expected titles here when `src/lib/whatsNew.ts` gains an entry.
- The sheet is never shown during onboarding or to a fresh sign-up.
