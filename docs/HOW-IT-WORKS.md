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

- **Length.** A cycle is short (~4 weeks: 2 Volume, 1 Intensity, 1 Peak), standard (~6: 3, 2,
  1) or long (~8: 4, 3, 1), stored as `cycleLength` on its blocks. The first cycle's length
  comes from the onboarding question "how long have you been lifting?" (under a year → short,
  1–3 years → standard, 3+ → long). Sessions per phase are its weeks × days a week (the days
  chosen in the cycle report, else the last four weeks of benching, else 3); Volume and
  Intensity round that to whole weeks of three. At standard and three a week that's
  9 + 6 + 3 + 1.
- **Heavy, light, medium.** Volume and Intensity (scheme version 3) run in weeks of three
  sessions, in the order they're logged, whatever the calendar says: a **heavy** day (one
  top single at RPE 6.5–8, then four back-off sets), a **light** day (paused bench, a
  three-second pause on the chest, RPE 6) and a **medium** day (the volume work). Each week
  climbs a step. A phase with more weeks than its scheme repeats the early weeks; one with
  fewer drops the middle ones, so it always ends on the heaviest. At standard length:

  | Volume (% of peak) | Week 1 | Week 2 | Week 3 |
  |---|---|---|---|
  | Heavy | 1 @ 87.5, then 4×6 @ 72.5 | 1 @ 90, then 4×6 @ 75 | 1 @ 90, then 4×6 @ 77.5 |
  | Light (paused) | 4×5 @ 65 | 4×5 @ 65 | 4×5 @ 67.5 |
  | Medium | 5×8 @ 67.5 | 5×8 @ 70 | 5×7 @ 72.5 |

  | Intensity (% of peak) | Week 1 | Week 2 |
  |---|---|---|
  | Heavy | 1 @ 90, then 4×4 @ 80 | 1 @ 92.5, then 4×4 @ 82.5 |
  | Light (paused) | 4×3 @ 70 | 4×3 @ 72.5 |
  | Medium | 5×5 @ 77.5 | 5×5 @ 80 |

  Peak (doubles, openers, the single) and Deload are unchanged; from four a week up, Peak
  still slots light repeats between its heavy sessions.
- **Older schemes.** Blocks made before version 3 keep their schemes only to read the
  sessions logged on them. On load, a block that hadn't started is re-planned on version 3,
  and one part-way through gets a `switchSlot`: its remaining slots run as a version 3 block
  of their own, starting on a heavy day.
- **Within a cycle.** Each logged session can move the loads still to come by one step (2.5%
  of the peak, at least 2.5kg), up to 7.5% either way. They come down on missed reps or a top
  set a full RPE over target (from RPE 8). They go up on a top set 1.5 RPE under target (sets of
  six and up) or 1 under (five and fewer), or on every set beating its reps by two. A heavy
  day's single is the first set when it's heavier than the back-offs, and is judged against
  its own target: missed or a full RPE over takes a step off; a full RPE under adds one, as
  long as the back-offs weren't over theirs. Light days move the loads only on missed reps. A Peak-block
  session that came in harder than planned (effort-adjusted e1RM against the plan's) scales
  the single down by as much.
  The offset is replayed from the logs, so editing a session corrects it.
- **Between cycles.** The next peak is the best effort-adjusted e1RM from the realization
  block. If the single was made at the peak or above at RPE 9.5 or easier (an unlogged RPE
  counts as 9.5), the next peak is at least one step over it. Changes are capped at 5% and
  rounded down to 2.5kg. A cycle that raises the peak adds a set to medium Volume days
  (up to two, and only while Volume stays under 20 hard sets a week at the cycle's
  frequency; light days don't count). One that doesn't drops those sets and gets a full deload week. Two in a row
  switch Volume to a rep lower and 2.5–5% heavier across the week (back-offs 4×5, medium
  5×6, paused 4×4), and back. A jumped-over test changes
  nothing. The deload's header says what happened.
- **Missed sets.** The reps picker starts at "miss" (0 reps). A missed set never counts as
  lifted in stats or records. Mid-cycle it takes a step off like any missed rep. A peak single
  that was only missed sets the next peak a step under the missed weight, never above the old
  peak: missing 102.5 on a 100 peak holds 100, missing 100 drops it to 97.5. A miss followed by
  a made single (add a set for the second attempt) is judged on the made one.
- **After the deload.** Logging the last deload session, or jumping past the deload onto the next
  cycle's first session, starts the next cycle's Volume block at
  the new peak, with whatever volume the review earned, and opens the cycle report
  (`src/lib/cycleReport.ts`, `CycleReportSheet`): the peak change and test single, best e1RM
  against before the cycle, sessions and sets by phase, effort against target, how far
  the loads moved, and missed sets, all read from the logs. It then asks what to peak at (the
  suggestion, a step either side, or any value), how many days a week to bench, and how long
  the cycle should be. It suggests a length: one step longer after a cycle that didn't raise the
  peak, one step shorter after two cycles in a row that raised it with almost nothing harder
  than target. Starting the cycle sets the Volume block's peak, length and frequency
  (`sessionsPerWeek`, `cycleLength`), which the rest of the cycle carries. Deloads saved before
  reviews existed get one read off the cycle (`cycleReviewFor`): the realization block's peak
  against the deload's, untested when its final slot was jumped over. Until the first Volume session is logged, the peak
  pill's Edit reopens the report. Deload weeks repeat one session; they have no light days.
- **Versions.** Blocks saved without a `schemeVersion` were planned on version 1, the
  original shorter schemes; version 2 lengthened the cycles. Every block made now is version 3
  (see "Older schemes" above).

## Estimated one-rep max

e1RM uses Brzycki: `weight × 36 / (37 − reps)`. It's what the progress charts and the
prescribed loads are built on.
