# My card

`/me` shows the user's own gymbro card exactly as gymbros see it (rarity, counts, records, streak), the private lists behind the gymbro/athlete counts, their routine, and a shareable PNG of the card.

## Sub-features

- `me-open` opens `/me` from Home's timeline (`Your card`) and from Profile (`My card`).
- `me-card` shows the card with no hype, no `Message`, no `Train under`; `this is what your gymbros see`.
- `me-people` opens the list of gymbros (or athletes) behind a count; only the owner can.
- `me-routine` shows the user's routine with `Anyone can see your routine and train under you.`.
- `me-share` builds the card image and saves it as `gymbro-card-<local-part>.png`.
- `me-edit-routine` links to `/exercises`.

## How to get to it (user POV)

- Home → gymbros timeline → first face, `me` (`/me`).
- Home → menu → `Profile` → `My card · View →`.

## Driving it with Playwright (verify.mjs)

Preconditions:

- Signed in; fake seeded with `/api/friends/profile` = the viewer's own card (5 sessions, 2 gymbros, record `Bench Press 80kg × 3`, `social.isSelf: true`) and `/api/users/people` = `[Lea Placeholder, Omar Example]`.

- **From Home.** Click `getByRole("link", { name: /^Your card, / })`. URL `/me`, heading `E2E Smoke`.
- **From Profile.** On `/profile` click `getByRole("link", { name: /^My card/ })`. URL `/me`; `this is what your gymbros see` shows; the record row `Bench Press 3 reps …` is disabled; there is no `Message` button; `Edit routine` links to `/exercises`.
- **People behind a count.** Click `getByRole("button", { name: /2\s*gymbros/ })`. A request `GET /api/users/people?…kind=gymbros` goes out and links `Lea Placeholder` and `Omar Example` show. `Escape` closes it.
- **Routine.** Click tab `Routine`. `Anyone can see your routine and train under you.` shows.
- **Share.** Click `Share card`. `getByRole("img", { name: "Your gymbro card" })` appears (built in the browser). Click `save`: a download named `gymbro-card-e2e-smoke.png` starts and `saved` flashes.
- **Run.** `node .claude/skills/verify-workout/verify.mjs run --feature my-card`
- **Proof.** `my-card/01-action-my-card.png`, `02-result-gymbros-sheet.png`, `03-action-share-card-preview.png`, `04-result-share-card-saved.png`, `gymbro-card-download.png` (the downloaded image), `video.webm`, `api-calls.json`.

## Gotchas

- The page reads `GET /api/friends/profile` with no `email`; without a seed the fake answers 404 and the page shows `No card found`. That is the default state for the bare `signIn()` fixture.
- Only `save` is driven: `share` appears only where `navigator.share` exists (not in desktop Chromium), and `copy` needs clipboard permission.
- The image takes a moment to build (`building your card…`) and then fades in; wait for the `img`, not a fixed sleep, before saving.
- The fake ignores query strings: `/api/users/people` returns its seed for both `kind=gymbros` and `kind=athletes`.
