# Deploying Workout

Workout is a Next.js app made for Vercel: Google sign-in through Auth.js, server state in
Vercel KV, one cron job for the daily reminders. Connect the repo to Vercel through the Git
integration and every push to `main` ships to production; other branches get preview
deployments. `vercel.json` only declares the cron.

## Environment variables

Set these in the Vercel project (Settings → Environment Variables), or in `.env.local` for
`pnpm dev`.

| Variable | Purpose |
| --- | --- |
| `AUTH_SECRET` | Required. Auth.js session secret (`pnpm dlx auth secret` generates one). |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Required. A Google OAuth client of type "Web application" with `https://<your-address>/api/auth/callback/google` among its authorized redirect URIs and `https://<your-address>` among its JavaScript origins. Every address the app is served from must be listed. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Required. Vercel KV (or any Upstash Redis REST endpoint). Vercel fills them in when you attach a KV store to the project. |
| `CRON_SECRET` | Required for reminders. The cron route rejects every request whose `Authorization` header is not `Bearer $CRON_SECRET`, and refuses to run at all when unset. Vercel sends the header automatically. |
| `VAPID_EMAIL`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Web push credentials (`pnpm exec web-push generate-vapid-keys`). Without them no push is sent. |
| `PLANNER_API_KEY` | Turns on "Plan with Dot". Without it only the copy-and-paste planner is offered. A free [Groq](https://console.groq.com) key works with the defaults. |
| `PLANNER_BASE_URL` | Optional. Any OpenAI-compatible endpoint; defaults to `https://api.groq.com/openai/v1`. |
| `PLANNER_MODEL` | Optional. Defaults to `openai/gpt-oss-120b`. |
| `LEGACY_OWNER_EMAIL` | Optional. The one account that can open the hidden `/dev` tools page in production. |
| `DEV_TOOLS` | Optional. `1` opens `/dev` to everyone (don't, in production). |

Don't point the planner at Google's free Gemini tier: its terms only allow paid use for apps
serving users in the EEA, Switzerland or the UK.

Auth.js v5 takes the host from the request and trusts it on Vercel, so leave `AUTH_URL` and
`NEXTAUTH_URL` unset. A value pinning an old host would send sign-ins back there.

## Custom domain

1. Vercel: Project → Settings → Domains → add your domain (or `vercel domains add <domain>
   <project>`). Vercel shows the DNS record to create; it may be a project-specific CNAME rather
   than `cname.vercel-dns.com`.
2. At your DNS provider, create that record **without** a proxy in front of it (on Cloudflare,
   grey cloud): Vercel must receive the traffic directly to issue and renew the certificate.
   `vercel domains verify <domain> --project <project>` confirms the setup.
3. Add the new address's callback and origin to the Google OAuth client, as in the table above.

The old `*.vercel.app` address keeps serving the same deployment. Don't redirect it: the
installed Home Screen app, push subscriptions and the local cache all belong to one origin.

## Moving users to a new address

Everything synced (profile, sessions, blocks, exercises, training days, weights, friends, coach
links) is in KV and follows the account. What belongs to the old origin is the Home Screen app,
its push subscription and its `localStorage`. Each user does this once:

1. Open the old address while online and let the home screen load. Saves that never reached
   the server are marked pending (`lift-tracker-pending-sync`) and re-sent on load.
2. Open the new address and sign in with Google.
3. Add it to the Home Screen again (Share → Add to Home Screen on iPhone), then delete the old
   icon.
4. Turn notifications back on in the new app. The server keeps one subscription per user, so
   this replaces the old one and the old install stops receiving reminders.

Device-only settings don't carry over and start from their defaults:

| Key | What resets |
| --- | --- |
| `lift-tracker-draft` | a session in progress that was not finished |
| `lift-tracker-mini-player` | the minimised in-progress session bar |
| `lift-tracker-routine-undo` | the one-week undo of the last applied plan |
| `lift-tracker-dot` | Dot switched off (comes back on) |
| `lift-tracker-haptics` | haptics switched off (comes back on) |
| `lift-tracker-weigh-in-skipped` | "skip this week" on the weigh-in prompt |
| `lift-tracker-layoff-dismissed` | a dismissed layoff banner |
| `lift-tracker-whats-new-seen` | the "what's new" sheet shows once more |
| `installGuideDismissed` | the install guide shows once more |

The remaining keys (`lift-tracker-sessions`, `-blocks`, `-exercises`, `-profile`,
`-training-days`, `-weights`, `-friends`, `-presences`, `bench_friend_last_active`,
`lift-tracker-exercises-migration`) are caches of server data and refill on first load;
`lift-tracker-pending-onboarding` only lives for the length of a sign-in redirect.
