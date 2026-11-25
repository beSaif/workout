# Bodyweight

Bodyweight lets a user opt in to weekly weigh-ins, log a reading from Home or the weight log, see the trend over 30 days, 90 days or all time, set a goal weight, and delete a reading.

## Sub-features

- `weight-opt-in` asks a user who never answered whether to check in weekly, then opens the first weigh-in.
- `weight-check-in` logs today's reading from a sheet seeded with the last one.
- `weight-chip` shows the latest reading in the Home header and opens the log.
- `weight-ranges` switches the chart between `30d`, `90d` and `all`.
- `weight-goal` saves a goal weight.
- `weight-delete` removes a reading after confirmation.

## How to get to it (user POV)

- Home, first visit after the feature shipped: the sheet `want to check in your weight weekly?`.
- Home header: the `+ weight` chip (no reading yet) or the `<kg> kg` chip (opens `/weight`).
- Menu → `Weight` (only when weekly check-ins are on).
- Weekly: the check-in sheet opens by itself on Home when the newest reading is a week old.
- `/weight`: `add`, the range buttons, `Goal weight` and the delete button on each log row.

## Driving it with Playwright (verify.mjs)

Preconditions:

- Signed in (`signIn()`), then the profile re-seeded without `weighInDaily` and `/api/weights` seeded with readings 200 and 60 days old (85.0 and 83.0 kg).

- **Opt in.** Open `/`. The dialog filtered by `want to check in your weight weekly?` is visible; click button `yeah, ask me weekly`. The last `/api/profile` POST has `weighInDaily: true`.
- **Weigh in.** The dialog `what did you weigh in at?` opens with `last one: 83.0kg`; click `log it`. The last `/api/weights` POST holds today's date at 83 kg.
- **Chip.** Link `Bodyweight 83.0 kilograms, open weight log` is in the header; click it. URL is `/weight`, heading `Weight`.
- **Ranges.** At the default `30d` the chart reads `one reading — log another to see a trend`; buttons `90d` and `all` replace it with the trend; `30d` brings it back.
- **Goal.** Fill the `spinbutton` with `78`, click `set goal`. The last `/api/profile` POST has `goalBw: 78` and `set goal` turns disabled.
- **Delete.** Buttons `Delete weigh-in from <day>` are listed newest first (3 rows); click the last, then `Delete` in the alertdialog `Delete the weigh-in from …?`. Two rows remain; the last `/api/weights` POST and localStorage `lift-tracker-weights` hold only the 60-day-old and today's readings.
- **Run.** `node .claude/skills/verify-workout/verify.mjs run --feature weight`
- **Proof.** `weight/01-action-opt-in-sheet.png`, `02-action-check-in-sheet.png`, `03-result-home-weight-chip.png`, `04-result-weight-all-range.png`, `05-action-set-goal.png`, `06-action-confirm-delete.png`, `07-result-weight-after-delete.png`, `video.webm`, `api-calls.json`, `local-storage.json`.

## Gotchas

- The weight picker is a scroll drum with no accessible controls; the journey logs the seeded value rather than scrolling to a new one.
- Readings are keyed by the browser's local calendar day; seed dates in the same zone the browser runs in.
- Sheets queue in a fixed order: install guide, What's new, opt-in, weekly check-in. A journey that leaves the first two on will never see the weight sheets.
- `signIn()` seeds `weighInDaily: false` (answered "no"): no chip, no Menu entry, no sheets. Re-seed the profile after `signIn()` to test this feature.
- The goal field's accessible name is its placeholder (`60`); select it by role `spinbutton`, it is the only one on the page.
- Home's progress card can still show bodyweight `—` right after the first weigh-in while the chip shows the reading; assert on the chip.
