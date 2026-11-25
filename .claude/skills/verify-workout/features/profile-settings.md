# Profile settings

`/profile` lets the user edit their name, bodyweight and target, switch the weekly weight check-in on or off, jump to the training-focus setting, see their stats and account details, and delete their account and data.

## Sub-features

- `profile-edit` edits name, bodyweight and target; a pinned `Save changes` bar appears only after a change.
- `profile-checkin` toggles `Weekly weight check-in`; when on, `View weight trend →` links to `/weight`.
- `profile-persist` saved values come back from the server after a reload.
- `profile-focus` `Lift-focused · change` (or `Balanced · change`) links to `/exercises`.
- `profile-delete` `Delete account & data` → `Yes, delete everything` wipes server and device data and signs out to `/welcome`.

## How to get to it (user POV)

- Home → menu (`Open menu`) → `Profile`.
- Home → tap `hello, <name>` (`Open profile`).

## Driving it with Playwright (verify.mjs)

Preconditions:

- Signed in with the default onboarded profile (E2E Smoke, 80 kg, bench, target 100, check-in off). No extra seed.

- **Open.** Click `Open menu`, then link `Profile` inside dialog `Menu`. URL `/profile`, heading `Profile`; the email `e2e-smoke@example.invalid` shows.
- **Edit.** Fill `getByPlaceholder("Saif")` = `Verify Lifter`, `getByPlaceholder("60")` = `82.5`, `getByPlaceholder("140")` = `110`; click `getByRole("switch", { name: "Weekly weight check-in" })` (becomes `aria-checked="true"`). Click `Save changes`; it turns into `Saved ✓`. Fake recorded `POST /api/profile` with `name`, `bw: 82.5`, `target: 110`, `weighInDaily: true`, `trainingMode: "lift-focused"`, `mainLift: "bench"`.
- **Persist.** Remove localStorage `lift-tracker-profile` and reload. The inputs show the new values, the switch is on, `View weight trend →` links to `/weight`, and `lift-tracker-profile` is rewritten with them.
- **Focus link.** Click `Lift-focused · change`. Heading `Routine` (`/exercises`).
- **Delete.** Back on `/profile` click `Delete account & data`, then `Yes, delete everything` in the sheet `Delete everything?`. The app lands on `/welcome` (heading `best workout tracker.`), the fake recorded one `DELETE /api/profile`, localStorage `lift-tracker-profile`/`lift-tracker-sessions` are gone, and visiting `/` redirects to `/welcome` (signed out).
- **Run.** `node .claude/skills/verify-workout/verify.mjs run --feature profile-settings`
- **Proof.** `profile-settings/01-action-edited-form.png`, `02-result-persisted-after-reload.png`, `03-action-delete-confirm.png`, `04-result-signed-out-welcome.png`, `video.webm`, `api-calls.json`, `local-storage.json`.

## Gotchas

- The inputs have no associated `<label>`; their accessible names are the placeholders (`Saif`, `60`, `140`). If those placeholders change, the selectors break.
- With check-ins on and at least one weigh-in logged, the bodyweight input is replaced by the latest weigh-in and an `Update →` link; the journey has no weigh-ins, so the input stays.
- For a Balanced profile the Target field and main lift are hidden.
- Delete is safe only because `DELETE /api/profile` is answered by the in-browser fake; sign-out goes to the server's real Auth.js `/api/auth/signout` (no data store involved). Never drive this against production.
