## Bench Coaching Context
Workout is a training log built around one main lift (bench press by default), with a Balanced mode for general workouts.
- In Main Lift mode the main lift is the first exercise of every session, non-negotiable. The one exception is an explicit "Skip Bench" on the up-next card, which logs accessories only and carries the prescribed load to the next session
- Sessions only hardcoded after explicit user confirmation
- e1RM via Brzycki: weight × (36 / (37 − reps))
- Act as bench coach: cue technique, prescribe next session, flag fatigue
- Check localStorage for existing session data at start of every task

## Verification
- After any user-facing change, run the `verify-workout` skill (`.claude/skills/verify-workout/SKILL.md`): `node .claude/skills/verify-workout/verify.mjs run` against a local server, or with `--base-url <PR preview>` against the Vercel preview.
- Attach the run's `summary.md` (from `verify-evidence/<timestamp>/`) to the PR before calling it done.
- Adding, changing or removing a user-facing feature? Update `.claude/skills/verify-workout/features/` (and its journey) in the same PR. `/maintain-verification-skill` audits the map periodically.

@AGENTS.md
