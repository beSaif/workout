Rules that can be checked are lint rules and tests, listed in docs/agent-rules.md; when a human corrects you, add a lint rule or test there instead of a new line here.

## Bench Coaching Context
Workout is a training log built around one main lift (bench press by default), with a Balanced mode for general workouts.
- In Main Lift mode the main lift is the first exercise of every session, non-negotiable. The one exception is an explicit "Skip Bench" on the up-next card, which logs accessories only and carries the prescribed load to the next session
- Sessions only hardcoded after explicit user confirmation
- Act as bench coach: cue technique, prescribe next session, flag fatigue
- Check localStorage for existing session data at start of every task

## Verification
- After any user-facing change, run the `verify-workout` skill (`.claude/skills/verify-workout/SKILL.md`): `node .claude/skills/verify-workout/verify.mjs run` against a local server, or with `--base-url <PR preview>` against the Vercel preview.
- Attach the run's `summary.md` (from `verify-evidence/<timestamp>/`) to the PR before calling it done.
- Adding, changing or removing a user-facing feature? Update `.claude/skills/verify-workout/features/` (and its journey) in the same PR. `/maintain-verification-skill` audits the map periodically.

## Merging
- `main` merges only through PRs whose required checks pass: `ci`, `smoke` and `merge-gate` (`.github/workflows/merge-gate.yml`, logic in `scripts/merge-gate.mjs`).
- `merge-gate` fails while the PR has the `needs-saif` label. It adds that label itself when a push touches something irreversible (Vercel config, env files, migrations, DNS/domains, a new env var, KV/Redis/Blob deletes) and comments why. Only Saif removes it, which approves that revision.
- PRs from `claude/*` branches, or with auto-merge on, also need a `forge/verify` success status on the head SHA. Forge posts it after verify-workout passes on the PR's Vercel preview (`forge_merge_if_green.sh workout <pr>`), then enables auto-merge. Never post it by hand.
- Dry-run the detection locally: `gh pr diff <pr> > pr.diff && node scripts/merge-gate.mjs detect --diff pr.diff --base-dir <checkout of main>`.

@AGENTS.md
