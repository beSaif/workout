# Onboarding

A new user answers a short questionnaire (name, bodyweight and weekly check-in, training focus, main lift, lifting experience, 1RM, goal), signs in with Google, and lands on a Home planned from those answers.

## Sub-features

- `onboarding-questions` walks the lift-focused path: name, bodyweight + "check in weekly", two explainers, training focus, lift, experience, phases explainer, 1RM, goal (with +10/20/30% suggestions), commitment gate.
- `onboarding-pending` keeps the answers on the device while Google sign-in round-trips.
- `onboarding-finish` saves the profile after sign-in and opens Home (with the first weigh-in prompt when weekly check-in is on).
- `onboarding-balanced` skips the lift, phases, 1RM and goal steps when "balanced" is chosen (not driven; see Gotchas).
- `onboarding-guard` sends a signed-in account without a profile from other pages to `/onboarding`, and an account with one from `/onboarding` to Home.

## How to get to it (user POV)

- `/welcome` → "get started".
- Open `/onboarding` directly (public, no session needed).
- Sign in with Google from the last step; Auth.js returns to `/onboarding?auth=1`.

## Driving it with Playwright (verify.mjs)

Preconditions:

- Doctor passes, including the `auth` check (the forged session must be accepted).
- Start signed out; the fake answers `GET /api/profile` with `null` (no profile).

- **Name.** `getByPlaceholder("Saif").fill("Verify")`, then `getByRole("button", { name: "continue" })`.
- **Bodyweight.** `getByPlaceholder("60").fill("82.5")`; `getByRole("button", { name: /check in weekly/ })` is visible and on by default; continue.
- **Explainers.** "most people quit" and "the program has two parts." each continue straight away.
- **Focus.** continue is disabled until `getByRole("button", { name: /^lift-focused/ })` is chosen.
- **Lift and experience.** `getByRole("button", { name: "Bench Press" })`, then `getByRole("button", { name: /^1–3 years/ })`; continue past the phases explainer.
- **1RM and goal.** `getByPlaceholder("100").fill("90")`; on the goal step `getByRole("button", { name: /^100kg/ })` (+10%) fills `getByPlaceholder("140")` with `100`.
- **Sign in.** `getByRole("button", { name: "sign in with google" })` becomes enabled after a beat; clicking it requests `accounts.google.com` (aborted) and leaves `lift-tracker-pending-onboarding` in localStorage with every answer.
- **OAuth return.** Stand in for Google: `signIn()` (forged cookie), `api.seed("/api/profile", null)`, `page.goto("/onboarding?auth=1")`.
- **Home.** URL is `/`; `getByRole("button", { name: "Open profile" })` reads "hello, Verify"; the meter `e1RM against the 100kg goal` and "Log Session" are visible; the sheet "what did you weigh in at?" opens.
- **Side effects.** `api.lastPost("/api/profile")` has `{ name: "Verify", bw: 82.5, trainingMode: "lift-focused", mainLift: "bench", anchor: 90, target: 100, trainingAge: "some", weighInDaily: true }`; `lift-tracker-profile` holds it and the pending key is gone.
- **Run.** `node .claude/skills/verify-workout/verify.mjs run --feature onboarding`
- **Proof.** `onboarding/` holds the `action` shots for name, training focus and the Google button, `04-result-home-after-onboarding.png`, `saved-profile.json`, `api-calls.json`, `local-storage.json` and `video.webm`.

## Gotchas

- Real Google OAuth cannot run in a journey. The OAuth return is simulated with the forged cookie for an account with no profile; the Auth.js callback itself is never exercised (only on a deployed target with a real Google account, by hand).
- `signIn()` seeds an onboarded profile on the fake; re-seed `/api/profile` to `null` before following `/onboarding?auth=1`, or onboarding redirects Home without saving.
- After the blocked Google navigation the page is a browser error page: go back to `/welcome` before reading localStorage. Do not use `/onboarding` for that read; with `?auth=1` it consumes the pending answers.
- Weekly check-in is on by default, so Home greets the new user with the weigh-in sheet over the dashboard.
- The balanced path (fewer steps, no lift fields in the profile) is mapped but not driven by this journey.
