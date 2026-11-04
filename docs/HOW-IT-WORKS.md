# How the moving parts work

Notes on the pieces that aren't obvious from the screens. Configuration for all of them is in
[DEPLOY.md](DEPLOY.md).

## Daily reminders

Two push notifications are sent by a single Vercel cron job declared in `vercel.json`, which
calls `/api/cron/reminders` once a day at 06:00 UTC.

- **Weigh-in reminder**: sent to anyone with daily check-ins switched on who has not logged a
  bodyweight for the current day. It names the streak once it reaches three days, and says so
  when a streak broke yesterday.
- **Time-off nudge**: sent once the last confirmed session is two days behind, then at most
  weekly until training resumes. Logging a session moves that date forward, which is what
  cancels the pending nudge.

At most one push goes out per user per day; the time-off nudge takes priority and leaves the
weigh-in reminder for the following day.

The rules live in `src/lib/reminders.ts` and read only stored data, so they work with the app
closed. Timers held inside the service worker cannot: the browser evicts an idle worker within
minutes, so `src/lib/swNotify.ts` is only used for the two-hour unfinished-session nudge.

To see what today would send you without waiting for the cron, open
`/api/cron/reminders?preview=1` while signed in. Preview never sends and never writes.

The job asks "did you log today" in each user's own calendar day. The browser reports its IANA
timezone when it registers a push subscription; users who registered before that existed are
treated as UTC until their next visit.

## Routine planner

`/plan` (linked from the Routine page as "Plan with Dot") replaces the user's training days,
muscle groups and exercises with a plan written by an LLM. Two ways in, one import path
(`src/lib/routinePlan.ts`): the plan is parsed and validated, laid over the current routine so
kept groups, days and exercises keep their ids and history, previewed with a summary of what
changes, and only saved when applied. Groups the plan drops are retired, not deleted, and the
previous routine is kept on the device for a week so the switch can be undone.

- **Plan with Dot**: five tap-to-answer questions, then one call to `/api/plan`, which plans
  from the stored routine with any OpenAI-compatible chat API. Each user gets 5 plans a day
  (tweaks included); a reply that can't be read gets one free repair attempt. Only the routine
  and the answers are sent, never the user's name, email or sessions.
- **Use your own AI**: copies a prompt carrying the routine and the format rules (shared with
  Dot, in `src/lib/planPrompt.ts`) for the user's own chatbot, and reads the reply pasted back,
  prose, code fences and curly quotes included.

## Main-lift program

`src/lib/prescription.ts` plans the main lift in four-phase cycles: accumulation (Volume),
transmutation (Intensity), realization (Peak) and a deload. Every load is a percentage of the
cycle's **peak**, the single realization ends on (stored as a block's `anchorWeight`). The
first cycle peaks at the 1RM given in onboarding.

- **Length.** At three sessions a week a cycle is 9 + 6 + 3 + 1 sessions, one scheme step per
  session. New blocks are sized from the last four weeks of benching (3 a week until there are
  two weeks to measure). At four or more a week, scheme steps repeat as light days, never
  two in a row; at two a week, steps are dropped.
- **Within a cycle.** Each logged session can move the loads still to come by one step (2.5%
  of the peak, at least 2.5kg), up to 7.5% either way. They come down on missed reps or a top
  set a full RPE over target (from RPE 8). They go up on a top set 1.5 RPE under target (sets of
  six and up) or 1 under (five and fewer), or on every set beating its reps by two. A Peak-block
  session that came in harder than planned (effort-adjusted e1RM against the plan's) scales
  the single down by as much.
  The offset is replayed from the logs, so editing a session corrects it.
- **Between cycles.** The next peak is the best effort-adjusted e1RM from the realization
  block. If the single was made at the peak or above at RPE 9.5 or easier (an unlogged RPE
  counts as 9.5), the next peak is at least one step over it. Changes are capped at 5% and
  rounded down to 2.5kg. A cycle that raises the peak adds a set to heavy accumulation days
  (up to two). One that doesn't drops those sets and gets a full deload week. Two in a row
  switch accumulation between eights-to-sixes and sixes-to-fours. A jumped-over test changes
  nothing. The deload's header says what happened.
- **Missed sets.** The reps picker starts at "miss" (0 reps). A missed set never counts as
  lifted in stats or records. Mid-cycle it takes a step off like any missed rep. A peak single
  that was only missed sets the next peak a step under the missed weight, never above the old
  peak: missing 102.5 on a 100 peak holds 100, missing 100 drops it to 97.5. A miss followed by
  a made single (add a set for the second attempt) is judged on the made one.
- **After the deload.** Logging the last deload session starts the next cycle's Volume block at
  the new peak, with whatever volume the review earned. Deload weeks repeat one session; they
  have no light days.
- **Versions.** Blocks saved before this carry no `schemeVersion` and run the original, shorter
  schemes until they finish. Every block made after that is version 2.

## Estimated one-rep max

e1RM uses Brzycki: `weight × 36 / (37 − reps)`. It's what the progress charts and the
prescribed loads are built on.
