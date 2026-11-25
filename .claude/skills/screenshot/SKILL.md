---
name: screenshot
description: Take phone-sized screenshots of Workout pages with mocked API data, no Google sign-in or Vercel KV needed. Use when asked for screenshots of a UI change, or to check a page visually before pushing.
---

# Screenshot the app

The app needs Google sign-in and Vercel KV, which a sandbox doesn't have. This
works around both:

- **Auth**: `shots.mjs` mints an Auth.js session cookie with the same `AUTH_SECRET`
  the dev server runs with, so `src/proxy.ts` lets the page through.
- **Data**: every page loads its data client-side from `/api/*`, and Playwright
  answers those calls from a scenario file. Nothing touches KV.

Pages that read their data on the server (not through `fetch("/api/...")` in the
browser) can't be mocked this way; say so rather than faking it.

## 1. Install and start the dev server

```bash
[ -d node_modules ] || pnpm install --frozen-lockfile
AUTH_SECRET=screenshot-secret-0123456789abcdef AUTH_GOOGLE_ID=x AUTH_GOOGLE_SECRET=x \
AUTH_TRUST_HOST=true KV_REST_API_URL=http://127.0.0.1:1 KV_REST_API_TOKEN=x \
pnpm exec next dev -p 3100
```

Run it in the background, then wait until `curl -s -o /dev/null localhost:3100/welcome`
succeeds (the first compile takes a while).

## 2. Write a scenario

Copy `examples/friend-profile.json` into the scratchpad and edit it. Shape:

- `viewer`: who is signed in (`name`, `email`).
- `mocks`: `{ "/api/path": <JSON body> }`, shared by every shot. Unmocked
  `/api/*` calls get `[]`. Match the real response shape: read the route in
  `src/app/api/**/route.ts` and the types in `src/lib/` before writing a mock.
- `shots[]`: each has `name`, `path`, optional `waitFor` (selector for an element
  that proves the page has loaded; without it the shot waits for the page's level-1
  heading, so set it for pages that have none, such as `/onboarding`), `mocks`
  (overrides for this shot), `viewport`, `fullPage`, and `steps`, run in order:
  `{ "click": "role:button:Label" | "<selector>", "scroll": 400, "waitFor": "text=…", "wait": 300 }`.

Use obviously fake people (example.com emails). Never put real users' data in
a scenario.

## 3. Capture, check, send

```bash
node .claude/skills/screenshot/shots.mjs <scenario.json> <scratchpad>/shots
```

Open every PNG with Read before sending it — confirm it shows the state you
meant (not a spinner, error or sign-in page) — then send them with
SendUserFile. Stop the dev server afterwards: stop its background task, or run
`pkill -f next-server` on its own (a `pkill -f "next dev"` inside a longer
command also matches, and kills, that command's own shell).

When you report back, say that:

- the data is mocked, and name the placeholder people;
- the round "N" badge bottom-left is Next's dev indicator, not the app;
- Chromium has no notch, so `env(safe-area-inset-*)` is 0: anything that
  depends on the iPhone safe area has to be checked on the device.
