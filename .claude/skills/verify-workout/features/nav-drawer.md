# Menu, Dot and sign out

The menu on Home is the way to every other section, holds the device switches for Dot (the mascot) and haptics, and signs the user out.

## Sub-features

- `menu-open` opens and closes the drawer (button, Escape, choosing a link).
- `menu-links` navigates to Home, Exercise Selection (`/exercises`), History, Weight (when check-ins are on), Gymbros and Profile.
- `menu-dot` hides or shows Dot on Home and remembers the choice on the device.
- `menu-haptics` turns haptic feedback off or on and remembers it on the device.
- `menu-sign-out` wipes the device's copy of the user's data, ends the session and lands on `/welcome`.
- `menu-install` offers `Install app` when the browser has a native install prompt (not drivable headless; see Gotchas).

## How to get to it (user POV)

- Home → the `Open menu` button (top right). The menu exists only on Home; other pages lead back with `Back to home`.

## Driving it with Playwright (verify.mjs)

Preconditions:

- Signed in, profile seeded with `weighInDaily: true` and a weigh-in for today (so the Weight entry shows and no check-in sheet covers Home).

- **Dot present.** On `/`, the decorative layer `[data-dot]` exists once.
- **Open.** Click button `Open menu`. Dialog `Menu` is fully in the viewport with links `Home`, `Exercise Selection`, `History`, `Weight`, `Gymbros`, `Profile` and switches `Show Dot` / `Haptics` both `aria-checked="true"`. Escape slides it out.
- **Links.** For each link: open the menu, click it, expect the URL (`/exercises`, `/history`, `/weight`, `/gymbros`, `/profile`) and the level-1 heading (`Routine`, `History`, `Weight`, `Gymbros`, `Profile`), then link `Back to home`. `Home` closes the menu on `/`.
- **Switches off.** Click `Show Dot` and `Haptics`. Both read `aria-checked="false"`, `[data-dot]` is gone, localStorage `lift-tracker-dot` and `lift-tracker-haptics` are `"off"`. After a reload both are still off and Dot is still gone.
- **Dot back.** Click `Show Dot`: `aria-checked="true"`, `[data-dot]` returns, `lift-tracker-dot` is removed.
- **Sign out.** Click `Sign out`. URL is `/welcome`, heading `best workout tracker.`, no `authjs.session-token` cookie, `lift-tracker-weights` is gone, and `/` redirects to `/welcome`.
- **Run.** `node .claude/skills/verify-workout/verify.mjs run --feature nav-drawer`
- **Proof.** `nav-drawer/01-action-menu-open.png`, `02-result-switches-off.png`, `03-action-sign-out.png`, `04-result-signed-out-welcome.png`, `video.webm`, `local-storage.json`.

## Gotchas

- The closed drawer stays in the DOM, translated off-screen and `inert`; assert `toBeInViewport()`, not `toBeVisible()`, and pick the logger dialog by its title, not as "the dialog".
- Dot is `aria-hidden` by design, so `[data-dot]` is the only handle (CSS by necessity).
- Sign out goes through the server's `/api/auth/signout` (Auth.js, no data store), the one `/api` call not answered by the fake.
- `Install app` needs Chrome's `beforeinstallprompt`, which headless Chromium never fires; it is unverified here.
- Haptics have no observable effect in a desktop browser; the proof is the switch state and the stored `"off"`.
