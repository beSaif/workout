---
name: verify-workout
description: Drive the Workout training-log PWA (workout.codesaif.dev; Next.js web UI, Google sign-in, data synced to /api) the way a user does and capture evidence. Use after any user-facing change and before calling a PR done, to prove a feature works on a local server or on the PR's Vercel preview. Every /api data call is answered by an in-browser fake, so no journey touches the shared production KV store.
---

# Verify Workout

Workout is a phone-first Next.js PWA. A user touches only the web UI: Home (main-lift program or Balanced mode), the session logger, History, Routine (`/exercises`), Plan with Dot (`/plan`), Weight, Gymbros, Profile. Data lives in localStorage and syncs to `/api/**`, which is backed by Vercel KV **shared with production**. So this skill never lets a journey reach a real `/api/**` data route: the journeys reuse `e2e/fixtures.ts`, whose `FakeApi` answers every same-origin `/api/**` call except `/api/auth/**` inside the browser, and whose `apiGuard` fails a journey if one leaks. Sign-in is a forged Auth.js session cookie (no Google OAuth). The harness also aborts every cross-origin request (Google, push services), so nothing is ever sent outside the app.

One entry point does everything:

```bash
node .claude/skills/verify-workout/verify.mjs launch   [--port 3210] [--rebuild]      # local server only
node .claude/skills/verify-workout/verify.mjs doctor   [--base-url <url>]
node .claude/skills/verify-workout/verify.mjs run      [--feature <id> ...] [--base-url <url>] [--out <dir>] [--keep-server] [--workers N]
node .claude/skills/verify-workout/verify.mjs features                                # ids and their journeys
node .claude/skills/verify-workout/verify.mjs cleanup                                 # stops only what launch started
```

`run` with no `--feature` drives every feature in [features/](features/README.md). Read the feature file before driving or changing a feature: it is the recipe and lists its traps.

## Targets

**(a) Local server (cloud sessions, sandboxes, no secrets).** `launch` builds the checkout with `next build` (skipped when `.next` was already built from the same commit and uncommitted `src/` changes) and starts `next start -p 3210` in its own process group with throwaway values: a random per-launch `AUTH_SECRET`, dummy `AUTH_GOOGLE_*`, `AUTH_TRUST_HOST=true`, and `KV_REST_API_URL=http://127.0.0.1:1` so even the server cannot reach a KV store. Planner, VAPID and cron secrets are empty. The pid, port, secret and source revision go to `node_modules/.cache/verify-workout/server.json`, the server log next to it. `run` without a target uses that server, or launches one itself and stops it when done (`--keep-server` keeps it).

**(b) A deployed URL, normally the PR's Vercel preview.**

```bash
BASE_URL=https://<preview>.vercel.app \
VERCEL_AUTOMATION_BYPASS_SECRET=<bypass secret> \
E2E_AUTH_SECRET=<that deployment's AUTH_SECRET> \
node .claude/skills/verify-workout/verify.mjs run
```

(`--base-url` works the same as `BASE_URL`.) Browser contexts send `x-vercel-protection-bypass` plus `x-vercel-set-bypass-cookie: true`; plain `request` calls and doctor's fetches send only `x-vercel-protection-bypass`, because the set-cookie header turns every answer into a 307 that sets the cookie. The same secrets are the repo's `E2E_AUTH_SECRET` / `VERCEL_AUTOMATION_BYPASS_SECRET` GitHub secrets used by `.github/workflows/smoke.yml`. Production (`workout.codesaif.dev`) is refused by doctor: verify previews, never prod.

## Launch

```bash
pnpm install --frozen-lockfile          # once; launch does it if node_modules is missing
node .claude/skills/verify-workout/verify.mjs launch
```

Ready means usable, not just listening: launch waits until `/welcome` returns 200 **and** a forged session gets Home (200, not a redirect to `/welcome`), up to 120 s. It prints `ready: http://localhost:3210`. If port 3210 is taken by anything this skill did not start, launch refuses (pick `--port`); it never drives or kills a server it did not start. A second `launch` while ours is alive reuses it. There is no seed data to load: each journey seeds its own state into its in-browser fake and localStorage, so every journey starts from an empty account in a fresh browser context, and journeys can run in parallel against one server.

Chromium: the cloud VM has Playwright's Chromium preinstalled for the repo's `@playwright/test` 1.63; elsewhere run `pnpm exec playwright install chromium` once.

## Doctor

`verify.mjs doctor` (also the first step of every `run`) is read-only, GETs pages only, never `/api` data. It answers "is this instance worth driving?":

- `target` is not production; `process` alive, `port` owned by our pid, `build` made from the current checkout (local only; a mismatch means cleanup then launch);
- `bypass` secret present for a `*.vercel.app` target (deployed only);
- `welcome` `GET /welcome` is 200 and is the Workout welcome page (401 → bypass secret missing or wrong);
- `manifest` `/manifest.webmanifest` is the PWA manifest;
- `auth` a cookie forged with `E2E_AUTH_SECRET` reaches Home (a 307 to `/welcome` means the secret does not match the deployment's `AUTH_SECRET`);
- `browser` Playwright's Chromium exists.

Run doctor again after any failed journey before trusting the next one.

## Drive

Journeys are Playwright tests in `journeys/<feature-id>.journey.ts`, one test per feature, tagged `@<feature-id>`; `run --feature <id>` greps that tag. They run under this directory's `playwright.config.ts` (Chromium at 393×852, service workers blocked so the fake sees every call, video on, no retries) and the fixtures in `journeys/harness.ts`, which extends `e2e/fixtures.ts` rather than replacing it:

- `signIn()` forges the session and seeds an onboarded Main Lift (bench, 80 kg anchor, 100 kg target) profile; `api.seed(path, body)` seeds any `/api` resource before `page.goto`; for a response the fake does not model, wrap `api.respond` in the journey (see `plan-with-dot`); do not use `page.route` for `/api` data paths, because `apiGuard` only trusts requests the fake answered and reports the rest as leaks.
- `api.calls` / `api.lastPost(path)` are the side effects: every request the UI sent, with its JSON body.
- `evidence.shot(page, "action" | "result", label)` and `evidence.json(name, data)` write into the evidence dir; `api-calls.json` and `local-storage.json` are written automatically after each journey.
- `externalRequests` lists cross-origin requests the page attempted (all aborted).
- `pageErrors` collects uncaught page errors; every journey ends with `expect(pageErrors).toEqual([])`.
- `journeys/flows.ts` and `e2e/flows.ts` hold the shared logger steps (`completeOpenLogger`, `logUpNextSession`, `confirmedSessions`).

Selectors are roles and accessible names (`getByRole("button", { name: "Log Session", exact: true })`, `getByRole("dialog").filter({ hasText: /Log Session \d+/ })`, `getByRole("meter", { name: /e1RM against/ })`) and route paths, never coordinates. The feature files list the exact handles per feature.

To drive something ad hoc (a new page before it has a journey), write a journey file with a new tag and its feature file, then `run --feature <id>`; do not drive the app outside the harness, since only the harness guarantees `/api` never reaches KV.

## Evidence

Every `run` writes `verify-evidence/<UTC timestamp>/` (or `--out <dir>`; `verify-evidence/` is git-ignored):

- `summary.md`: target URL, git SHA (noting uncommitted app changes), and per feature id: pass/fail, duration, and every artifact path;
- `test-output.txt`: the Playwright list-reporter output; `results.json`: the JSON report;
- `<feature-id>/NN-action-*.png` and `NN-result-*.png`: the user action and the state it produced;
- `<feature-id>/video.webm`: the whole journey; `api-calls.json`, `local-storage.json` and any journey-specific JSON: the side effects;
- `<feature-id>/failure-*.png|.zip`: screenshot and trace of a failed journey; `playwright-output/`: Playwright's raw output.

Proof standards: drive the real user path (buttons, forms, links), never internal setters or test-only endpoints; capture the action and the resulting state, not just the final screen; check the side effect (the request body on the fake, localStorage, a reload that reads it back) alongside what is visible. The only mocks are at the `/api` boundary that the production app already isolates behind `fetch`, and cross-origin calls, which are aborted and asserted on. A journey that cannot meet a precondition fails and says why in its feature's Gotchas; never weaken it to pass. Attach `summary.md` to the PR.

## Cleanup

`verify.mjs cleanup` stops only the server recorded in `server.json`: its process group and children, by pid, never by name (no `pkill next`). It removes the state file and leaves `verify-evidence/` untouched, printing what it kept. `run` cleans up a server it launched itself, also after a failed doctor or journey. Playwright closes its browsers on exit.

## What a local run cannot prove

Only a run against the deployed preview covers: Vercel Deployment Protection and the bypass header/cookie; the deployment's real `AUTH_SECRET` and `__Secure-` cookie over HTTPS; Vercel's headers, edge proxy and static asset serving; the real env (planner key, VAPID keys, cron). Neither target covers real Google OAuth, real KV reads/writes, real push delivery or the LLM planner: those boundaries are faked or aborted by design.

## Maintenance

The map in `features/` is the maintained verification source. Change a user-facing feature → update its feature file and journey in the same PR. `/maintain-verification-skill` audits the map against the source and the live app.
