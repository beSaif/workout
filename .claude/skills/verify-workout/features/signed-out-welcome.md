# Signed-out welcome

A visitor without a session is sent from any app page to the welcome page, which offers onboarding for new users ("get started") and Google sign-in for returning ones ("i've done this before").

## Sub-features

- `welcome-redirect` sends a signed-out visit to `/` to `/welcome` (optionally with `?callbackUrl=`).
- `welcome-page` shows the "best workout tracker." heading and both entry points.
- `welcome-get-started` links to `/onboarding` without needing a session.
- `welcome-google-signin` starts Auth.js Google OAuth from "i've done this before".

## How to get to it (user POV)

- Open the app (any route but `/welcome` and `/onboarding`) without being signed in.
- Sign out from the menu, which lands on `/welcome`.
- A signed-in visit to `/welcome` is redirected to Home instead.

## Driving it with Playwright (verify.mjs)

Preconditions:

- Doctor passes for the target. No session cookie: the journey does not call `signIn()`.
- The harness aborts every cross-origin request, so Google is never contacted.

- **Redirect.** `page.goto("/")`. The URL matches `/welcome(?callbackUrl=…)`.
- **Welcome page.** `getByRole("heading", { level: 1, name: "best workout tracker." })` is visible; `getByRole("link", { name: "get started" })` has `href="/onboarding"`; `getByRole("button", { name: "i've done this before" })` is visible.
- **Google sign-in.** Click "i've done this before". The browser requests `https://accounts.google.com/o/oauth2/v2/auth?…redirect_uri=<target>/api/auth/callback/google` (asserted with `page.waitForRequest`, listed in `externalRequests`), which the harness aborts.
- **Get started.** From `/welcome`, click "get started". The URL is `/onboarding` and "what do we call you?" is visible.
- **No writes.** The FakeApi recorded no non-GET call.
- **Run.** `node .claude/skills/verify-workout/verify.mjs run --feature signed-out-welcome`
- **Proof.** `signed-out-welcome/` holds `01-result-welcome-after-redirect.png`, `02-action-tap-ive-done-this-before.png`, `03-result-google-signin-blocked.png`, `04-result-onboarding-first-question.png`, `google-signin-request.json` (the OAuth URL the app built), `api-calls.json` and `video.webm`.

## Gotchas

- "i've done this before" is a server action: the OAuth redirect is built by the target's server, so `client_id` is the target's Google client (a dummy locally). Never let it complete.
- After the aborted Google navigation the tab shows a browser error page; navigate back to the app's origin before reading `localStorage` or asserting UI.
- Only on a deployed target is the cookie `__Secure-authjs.session-token`; the redirect itself is identical.
