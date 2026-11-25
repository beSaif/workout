# Install as an app (PWA)

Workout installs to a phone's home screen: it serves a standalone web manifest with PNG icons and a service worker, and shows signed-in users a one-time guide to adding it to the home screen.

## Sub-features

- `pwa-manifest` serves `/manifest.webmanifest` (standalone, start URL, icons that load as PNG).
- `pwa-sw` serves `/sw.js` as JavaScript and registers it at scope `/`, even signed out.
- `pwa-guide` shows `add this to your home screen` once on Home, with Android (Chrome) or iOS (Safari) steps, or `open this on your phone` on desktop.
- `pwa-guide-dismiss` remembers `on it` / `maybe later` on the device.
- `pwa-native-install` offers the browser's own install dialog (`install app`) when Chrome provides one.

## How to get to it (user POV)

- Open the site on a phone browser and sign in: the guide slides up on Home.
- Browser menu → Add to Home screen / Install app.
- Menu → `Install app` when the browser offers it.

## Driving it with Playwright (verify.mjs)

Preconditions:

- The journey file sets `serviceWorkers: "allow"` and an Android Chrome user agent.
- For the guide: signed in, with an init script that removes `installGuideDismissed` on the first load only (`signIn()` sets it on every load).

- **Manifest.** `request.get("/manifest.webmanifest")` is 200 with `display: "standalone"`, a `start_url` and icons; each icon URL is 200 `image/png`.
- **Worker script.** `request.get("/sw.js")` is 200 with a JavaScript content type.
- **Registration.** Open `/welcome` (signed out). `navigator.serviceWorker.ready` resolves with scope path `/` and script path `/sw.js`.
- **Guide.** Sign in, open `/`. The dialog filtered by `add this to your home screen` shows the Chrome steps (`open in Chrome … if you're not already`).
- **Dismiss.** Click `maybe later`. The dialog closes, localStorage `installGuideDismissed` is `"1"`; Menu → `History` → `Back to home` and it stays closed.
- **Run.** `node .claude/skills/verify-workout/verify.mjs run --feature pwa-install`
- **Proof.** `pwa-install/manifest.json`, `service-worker.json`, `01-result-welcome-sw-registered.png`, `02-action-install-guide.png`, `03-result-home-guide-dismissed.png`, `video.webm`.

## Gotchas

- Every other journey blocks service workers (a worker could sit between the page and the `/api` fake); only this one allows it.
- With the default desktop user agent the guide is the short `open this on your phone` sheet; the phone steps need a phone user agent.
- A reload re-runs `signIn()`'s init script, which re-dismisses the guide; prove persistence with in-app navigation.
- On a protected preview, `request` calls must carry only `x-vercel-protection-bypass`; adding `x-vercel-set-bypass-cookie` turns them into 307s (the config already does this).
- `install app` (native prompt) needs Chrome's `beforeinstallprompt`, which headless Chromium never fires; installing for real needs a phone.
- The Android hint renders as `open in Chromeif you're not already` (no space) in Chromium; the journey matches with optional whitespace.
