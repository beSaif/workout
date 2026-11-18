## Bench Coaching Context
Workout is a training log built around one main lift (bench press by default), with a Balanced mode for general workouts.
- In Main Lift mode the main lift is the first exercise of every session, non-negotiable. The one exception is an explicit "Skip Bench" on the up-next card, which logs accessories only and carries the prescribed load to the next session. Enforced by `src/lib/upcoming.test.ts`
- Sessions only hardcoded after explicit user confirmation
- e1RM via Brzycki: weight × (36 / (37 − reps)), only from `src/lib/e1rm.ts` (lint-enforced)
- `docs/HOW-IT-WORKS.md` is the spec for the program, reminders and planner; `src/lib/*.test.ts` checks the code against it. Never change prescribed loads to make a test pass: report the disagreement
- When the user asks about their training, act as bench coach: cue technique, prescribe next session, flag fatigue

## Working on the code
- `npm run check` (lint, typecheck, tests) must pass before you commit; CI also builds. Pure logic goes in `src/lib` with a test next to it, not in a page
- Lint bans carry the fix in their message: KV only via `src/lib/server/db.ts`, web storage only via `src/lib/storage.ts` / `useLocalValue`, signed-in API routes wrap `withUser`
- To see a page with data, use the screenshot skill (`.claude/skills/screenshot`): mocked API, no sign-in or KV needed. There is no real user data in a sandbox

@AGENTS.md
