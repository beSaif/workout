---
name: verify-workout
description: Drive the Workout training-log PWA (workout.codesaif.dev; Next.js web UI, Google sign-in, data synced to /api) the way a user does and capture evidence. Use after any user-facing change and before calling a PR done, to prove a feature works on a local server or on the PR's Vercel preview. Every /api data call is answered by an in-browser fake, so no journey touches the shared production KV store. Also holds the seeded fuzz harness (fuzz/fuzz.mjs) for nightly read-only monkey runs, production included.
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

**(a) Local server (cloud sessions, sandboxes, no secrets).** `launch` builds the checkout with `next build` (skipped when `.next` was already built from the same commit and uncommitted `src/` changes) and starts `next start -p 3210` in its own process group with throwaway values: a random per-launch `AUTH_SECRET`, dummy `AUTH_GOOGLE_*`, `AUTH_TRUST_HOST=true`, and `KV_REST_API_URL=http://127.0.0.1:1` so even the server cannot reach a KV store. Planner, VAPID private and cron secrets are empty; the build gets a fixed throwaway `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (no private key exists for it) so the notifications opt-in renders. The pid, port, secret and source revision go to `node_modules/.cache/verify-workout/server.json`, the server log next to it. `run` without a target uses that server, or launches one itself and stops it when done (`--keep-server` keeps it).

**(b) A deployed URL, normally the PR's Vercel preview.**

```bash
BASE_URL=https://<preview>.vercel.app \
VERCEL_AUTOMATION_BYPASS_SECRET=<bypass secret> \
E2E_AUTH_SECRET=<that deployment's AUTH_SECRET> \
node .claude/skills/verify-workout/verify.mjs run
```

(`--base-url` works the same as `BASE_URL`.) Browser contexts send `x-vercel-protection-bypass` plus `x-vercel-set-bypass-cookie: true`; plain `request` calls and doctor's fetches send only `x-vercel-protection-bypass`, because the set-cookie header turns every answer into a 307 that sets the cookie. The same secrets are the repo's `E2E_AUTH_SECRET` / `VERCEL_AUTOMATION_BYPASS_SECRET` GitHub secrets used by `.github/workflows/smoke.yml`. Production (`workout.codesaif.dev` and its original vercel.app alias, both listed in `lib/target.mjs`) is refused by doctor: verify previews, never prod. Only the fuzz harness below may touch production, read-only and only with `--allow-production`.

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

- `signIn()` forges the session and seeds an onboarded Main Lift (bench, 80 kg anchor, 100 kg target) profile; `api.seed(path, body)` seeds any `/api` resource before `page.goto`; for a response the fake does not model, use `answer(api, method, path, json)` from `harness.ts`; do not use `page.route` for `/api` data paths, because `apiGuard` only trusts requests the fake answered and reports the rest as leaks.
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

## Fuzz

`fuzz/fuzz.mjs` is a seeded monkey tester built on the same pieces (verify.mjs's launch and doctor, `e2e/fixtures.ts`'s `FakeApi`, `apiGuard` leak tracking and `signIn`). It is meant for a nightly run against production by Forge, and runs just as well against a local server or a preview.

```bash
node .claude/skills/verify-workout/fuzz/fuzz.mjs run [--base-url <url>] [--allow-production] [--seed <int>] [--minutes <n>] \
     [--max-actions <n per feature>] [--feature <id> ...] [--out <dir>] [--signed-out-only] [--keep-server] [--port <n>]
node .claude/skills/verify-workout/fuzz/fuzz.mjs selftest      # the safety wall, end to end, against the local server
```

No `--base-url` (or `BASE_URL`) launches/reuses the local server exactly as `verify.mjs run` does. Nightly production: `node .claude/skills/verify-workout/fuzz/fuzz.mjs run --base-url https://workout.codesaif.dev --allow-production --seed <n>`. The same `--seed` replays the same run (account states, actions and typed values); the seed is printed and recorded either way (random when omitted).

**What a run does.** One worker, one browser context at a time (fits in about 1.5 GB):

1. *Signed-out phase (always).* Doctor (read-only GETs). Then the run's only real request to a data route: `GET /api/profile` with no cookie must answer 401 JSON. In the browser: every protected route documented in `features/*.md` ("How to get to it", dynamic segments filled with samples) must land on `/welcome`; `/welcome` and `/onboarding` answer 200; the manifest, every icon it lists and `/sw.js` serve. Then a monkey on `/welcome` and one on `/onboarding`.
2. *Signed-in phase* (needs `E2E_AUTH_SECRET` = the target's `AUTH_SECRET`; a local server has its own). Every selected feature's existing journey once (verify's config, one worker, under the fuzz write wall), then one monkey per feature from its entry route in `features/routes.json`, signed in as the dedicated test user `Fuzz Bot <fuzz-bot@workout.invalid>` (sub `fuzz-bot`) with a seeded random account: Main Lift or Balanced, main lift, anchor/target/bodyweight edge values, 0-40 sessions with blocks, weigh-ins, default or custom routine. All of it is seeded into the fake; it passes the server's own validators (`src/lib/validate.ts`). Without a secret (production, normally) the phase is `skipped: no auth secret for this target`.

A monkey takes up to `--max-actions` (default 40) seeded actions within its share of `--minutes` (default 10; the monkeys split it evenly, journeys and signed-out checks run before and are not counted): click visible enabled same-origin buttons, links, tabs, menu items and switches (inside the top open dialog if one is open); fill inputs with `0`, `-1`, `999999`, `12,5`, `12.5`, empty, spaces, a 200-character string, emoji (dates with edge dates); toggle checkboxes; choose select options; Escape; scroll; back, forward, reload. After **every** action it checks the invariants: no uncaught page error; no `console.error` outside `fuzz/allowlist.json`; no same-origin 5xx; no `/api` data request that escaped the fake; `main` has text; no visible `NaN`, `undefined`, `null`, `Infinity`, `[object Object]` or `Invalid Date`; no horizontal overflow at 393×852; no spinner still visible after 10 s. On a violation it saves a screenshot and, off production, a trace, replays the same seed, state and steps once in a fresh context (`reproducible: true|false`), and moves on to the next feature.

**Safety model** (unit-tested in `fuzz/fuzz.test.ts`, which `pnpm test` runs; end to end in `fuzz.mjs selftest`):

- *Target guard* (`lib/target.mjs`): localhost / 127.0.0.1 and `https://*.vercel.app` previews are allowed; `workout.codesaif.dev` and its vercel.app alias only with `--allow-production`; anything else is refused with exit 2. `verify.mjs` keeps refusing production.
- *Contexts*: every journey and monkey gets a new non-persistent context (`browser.newContext`, no user data dir, no storage state from disk) with service workers blocked.
- *Requests* (`fuzz/lib/classify.mjs`, installed by `fuzz/guard.ts`): same-origin `/api/**` except `/api/auth/**` → the `FakeApi`; cross-origin → aborted; Next server actions (`Next-Action`), form posts and any other same-origin non-GET/HEAD → aborted; on production, `/api/auth/**` POSTs other than sign-out → aborted. Aborted requests are recorded by kind (`blockedRequests`), never sent, and not findings. A page error such as "Failed to fetch" in an action where the guard aborted a request is counted as harness-induced, not a finding. A journey that fails after the wall blocked one of its requests (signed-out-welcome's sign-in server action) is `inconclusive`, not `failed`.
- *Net effect*: a run cannot write to KV or any other server-side store. Its only server reads are page loads, static assets, Auth.js session/CSRF reads and the one unauthenticated 401 check.
- Secrets (`E2E_AUTH_SECRET`, the bypass secret, the local `AUTH_SECRET`, session cookies, JWTs) are redacted from everything it prints or writes.

**Exit codes**: 0 = the run completed, findings or not; 2 = harness or target error (bad arguments, guard refusal, doctor failure, a crashed harness step), so a scheduler can tell bugs from breakage.

**Output** (`--out`, default `verify-evidence/fuzz-<UTC ts>/`): `summary.md` (one screen: target, seed, replay command, phases, counts, each finding with numbered repro steps), `fuzz-report.json`, `monkeys/<id>/steps.txt` (every monkey's action log) plus `finding-<sig>.png` / `trace-<sig>.zip`, `signed-out/`, `journeys/` (verify's evidence for the journeys), `fuzz-output.txt`. The report:

```jsonc
{
  "target": "https://workout.codesaif.dev", "production": true, "seed": 1, "startedAt": "<ISO>", "durationMs": 0,
  "phases": [{ "name": "signed-out", "signedIn": false, "status": "passed|failed|skipped", "skippedReason": "…" }],
  "journeys": [{ "feature": "home-dashboard", "status": "passed|failed|inconclusive|not run", "error": "…", "blocked": [] }],
  "monkeys": [{ "id": "home-dashboard", "status": "passed|failed|skipped", "actions": 40, "state": "<account summary>" }],
  "actions": 0,                                   // monkey actions in total
  "blockedRequests": { "external": 0, "server-action": 0, "auth-write": 0, "form-post": 0, "other-write": 0 },
  "apiLeaks": 0, "unansweredDataRequests": 0, "harnessInduced": 0,
  "findings": [{
    "signature": "12 hex", "kind": "page-error|console-error|server-5xx|api-leak|blank-page|bad-text|horizontal-overflow|stuck-spinner|auth-redirect|public-page|public-asset|api-unauthenticated",
    "feature": "<id> or signed-out", "route": "/session/<n>", "message": "…", "reproducible": true,
    "known": "https://github.com/beSaif/workout/issues/N or null", "steps": ["…"], "screenshot": "monkeys/…png", "trace": "monkeys/…zip"
  }],
  "errors": []                                    // harness errors; non-empty means exit 2
}
```

The signature is `sha1(kind | route pattern | message)` with numbers, ids, emails and URLs normalized (`fuzz/lib/signature.mjs`), so the same bug keeps its signature from night to night.

**Allowlist and known issues.**

- `fuzz/allowlist.json` silences known `console.error` noise: add `{ "message": "<regex>", "url": "<optional regex on the source URL>", "reason": "<why this is not a bug>" }`. Every entry needs a reason (the unit tests check). Never allowlist an app error to make a run green; file it instead.
- `fuzz/known-issues.json` maps a finding signature to its GitHub issue: `{ "0123456789ab": "https://github.com/beSaif/workout/issues/123" }`. Matching findings are reported as `known` (with the URL), not new. Remove the entry when the issue is fixed.
- Adding a feature: its file in `features/` needs an entry in `features/routes.json` (`{ "route": "/entry", "signedIn": true }`); a unit test checks the two list the same ids.

## Maintenance

The map in `features/` is the maintained verification source. Change a user-facing feature → update its feature file and journey in the same PR. `/maintain-verification-skill` audits the map against the source and the live app.
