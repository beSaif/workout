<p align="center">
  <img src="docs/logo.svg" width="120" alt="Workout" />
</p>

<h1 align="center">Workout</h1>

<p align="center">A training log built around the one lift you care about.</p>

This started as a program for me and my bench press: one lift, a block of sessions, a number that
had to go up. Then a friend asked to use it, so it got sign-in. Then more friends asked, and most
of them didn't want to live on bench alone, so it grew a Balanced mode for general training. Now
you pick: a balanced routine, or one main lift you want to push as far as it goes. Either way
Dot, the little mascot, plans your next session, nags you about the weigh-in, and falls asleep
if you don't show up for five days.

<p align="center">
  <img src="docs/screenshots/home.png" width="190" alt="Home: gym bros, bodyweight, road to the target, block timeline" />
  <img src="docs/screenshots/home-upnext.png" width="190" alt="The up-next session card and logged sessions" />
  <img src="docs/screenshots/gymbros.png" width="190" alt="Gym bros with a live friend and a message" />
  <img src="docs/screenshots/plan-review.png" width="190" alt="Plan with Dot: what changes before you apply it" />
</p>

**Try it:** [workout.codesaif.dev](https://workout.codesaif.dev). Sign in with Google, add it to
your home screen.

## What it does

- **Main Lift mode**: block periodization for one lift. The main lift is always first in the
  session; the next load is prescribed from how the last one went, and e1RM (Brzycki) tracks the
  trend. Feeling strong? Tap any later session in the block view to jump straight to it.
- **Balanced mode**: training days, muscle groups and exercises of your own, logged the same way.
- **Plan with Dot**: answer five questions and an LLM rewrites your routine, previewed before it's
  applied and undoable for a week. Or copy the prompt into your own chatbot and paste the plan
  back.
- **Gym bros**: add friends, see their sessions, react and comment.
- **Bodyweight** check-ins with streaks, and push reminders when you've gone quiet.

## Run it locally

```bash
npm install
cp .env.example .env.local      # fill in the Google OAuth client and a KV store
npm run dev                     # http://localhost:3000
```

The variables are listed in [docs/DEPLOY.md](docs/DEPLOY.md). Without a KV store nothing
persists; `.claude/skills/screenshot` shows how to run the pages against mocked data instead.

## Development checks

CI (`.github/workflows/ci.yml`) runs these on every pull request and on pushes to `main`, with
pnpm 10 on Node 24 like Vercel. Run them locally before pushing:

```bash
pnpm install --frozen-lockfile
pnpm lint         # ESLint (next/core-web-vitals + TypeScript rules)
pnpm typecheck    # tsc --noEmit, strict
pnpm test         # Vitest unit tests for src/lib (src/lib/__tests__)
pnpm build        # next build; needs no secrets
```

### Smoke tests

`.github/workflows/smoke.yml` (check `smoke`) runs the Playwright specs in `e2e/` on every pull
request against its Vercel preview, in Chromium and iPhone WebKit. They sign in with a forged
Auth.js cookie and answer every `/api/*` call (except `/api/auth/*`) from an in-memory fake,
failing if one reaches the network: KV is shared with production, so tests never touch it.

To run them locally against a preview:

```bash
pnpm exec playwright install chromium webkit          # once
BASE_URL=https://<preview>.vercel.app \
E2E_AUTH_SECRET=<the preview's AUTH_SECRET> \
VERCEL_AUTOMATION_BYPASS_SECRET=<protection bypass secret> \
pnpm test:e2e                                         # add --project=chromium for one browser
```

GitHub secrets the workflow needs: `E2E_AUTH_SECRET` (the Preview environment's `AUTH_SECRET`,
used to sign the session cookie) and `VERCEL_AUTOMATION_BYPASS_SECRET` (Vercel → Settings →
Deployment Protection → Protection Bypass for Automation). It can also be run by hand from the
Actions tab with a `base_url`.

Before the HTML report is uploaded, `scripts/redact-playwright-report.py` scrubs it (including the
trace zips and the report data embedded in `index.html`): traces record request headers and
cookies, so they would otherwise carry the bypass secret and session tokens into a public artifact.
If anything is left, the step fails and the report is not uploaded.

### Verifying a change

User-facing changes are proven with the verify-workout skill ([.claude/skills/verify-workout/SKILL.md](.claude/skills/verify-workout/SKILL.md)).
Run `node .claude/skills/verify-workout/verify.mjs run` locally, or add `--base-url <PR preview>` with
`VERCEL_AUTOMATION_BYPASS_SECRET` and `E2E_AUTH_SECRET` set to run it against the Vercel preview.
Evidence lands in `verify-evidence/<timestamp>/` (`summary.md`, screenshots, video). The feature map
lives in `.claude/skills/verify-workout/features/`; update it in the same PR when a user-facing feature changes.

## Under the hood

Next.js (App Router) on Vercel, Auth.js with Google, Vercel KV for everything synced, and one
cron job for reminders. The Vercel integration deploys `main` on every push.

- [docs/DEPLOY.md](docs/DEPLOY.md): environment variables, custom domains, moving users to a
  new address.
- [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md): how the reminders and the planner decide what to
  do.

## License

[MIT](LICENSE)
