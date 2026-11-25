# Routine editor

The Routine page lets a user shape their split by hand: create, rename and delete training days and choose which muscle groups each day trains, add muscle groups, and inside a group add, rename, reorder and remove exercises and set how many working sets each opens with in the logger. Every change saves straight away and comes back from the server on another device.

## Sub-features

- `day-add` adds a training day and opens it expanded to pick its muscles.
- `day-muscles` toggles muscle-group chips on a day.
- `day-rename` renames a day inline; `day-delete` deletes it after a confirmation sheet.
- `group-add` adds a muscle group, optionally assigned to a day in the same form.
- `exercise-add` adds an exercise to a group (warns on similar names, offers "Add anyway").
- `exercise-sets` raises or lowers an exercise's default set count (1–8).
- `exercise-edit` renames, reorders (up/down) and removes exercises in Edit mode; `group-delete` retires a whole group.
- `routine-persist` keeps the routine after a reload with the device copy cleared.

## How to get to it (user POV)

- Menu → Exercise Selection (`/exercises`, heading "Routine").
- Tap a muscle group row on the Routine page → `/exercises/<groupId>` (e.g. `/exercises/back`).
- Profile → "Lift-focused · change" also lands on `/exercises`.

## Driving it with Playwright (verify.mjs)

Preconditions:

- Signed in with the onboarded profile and the default routine (Day A/B/C; Back has Lat Pulldown, Single Cable Seated Pulldown, Cross Rear Delt Fly).
- `verify.mjs doctor` is green.

- **Add a day.** Click `+ Add training day`, fill textbox `New training day name` with `Push Day`, click `Add day` (exact). Then click chip button `Chest` (exact): `aria-pressed="true"`; `POST /api/training-days` has `Push Day` with `muscleGroupIds: ["chest"]`.
- **Rename the day.** Click `Rename` (exact), fill textbox `Day name` with `Push`, press Enter. Button `Push Chest…` shows; the saved day names are `Day A, Day B, Day C, Push`.
- **Add a group.** Click `+ Add muscle group`, fill `New muscle group name` with `Abs`, click chip `Day A`, click `Add group`. Link `Abs No exercises · Day A` appears; `POST /api/exercises` contains `Abs` and Day A's `muscleGroupIds` contains its id.
- **Open a group.** Click link `Back 3 exercises…`; URL is `/exercises/back`, h1 `Back`.
- **Add an exercise.** Click `+ Add exercise`, fill `New exercise name` with `Seal Row`, click `Add` (exact). Text `4 exercises`.
- **Set count.** Click `More sets for Seal Row`; the saved Back group has `Seal Row` with `defaultSets: 3`.
- **Edit.** Click `Edit` (exact); fill the 4th `Exercise name` textbox with `Chest-Supported Row` + Enter; click `Move Chest-Supported Row up`; click `Delete Cross Rear Delt Fly` and confirm `Remove` in the `alertdialog`; click `Done`. Saved order: `Lat Pulldown, Single Cable Seated Pulldown, Chest-Supported Row`.
- **Persistence.** Remove `lift-tracker-exercises` and `lift-tracker-training-days` from localStorage and reload: `3 exercises`, `Chest-Supported Row` shown, no `Cross Rear Delt Fly`; `/exercises` still shows `Push Chest` and `Abs … · Day A`.
- **Run.** `node .claude/skills/verify-workout/verify.mjs run --feature routine-editor`
- **Proof.** `routine-editor/01-action-add-training-day.png`, `02-action-add-muscle-group.png`, `03-result-routine-with-push-and-abs.png`, `04-action-remove-exercise-confirm.png`, `05-result-back-group-after-reload.png`, `06-result-routine-after-reload.png`, `saved-routine.json`, `api-calls.json`, `video.webm`.

## Gotchas

- A new exercise's default set count is 3 when it is first in its group and 2 otherwise, so one `More sets` click on a fourth exercise gives 3, not 4.
- Renames save on blur or Enter; asserting before either fires sees the old name.
- Only clear the two routine keys before reloading: clearing `lift-tracker-exercises-migration` too re-runs the config migration and changes the routine.
- While the account trains under a coach (friend profile → train under), days and groups are read-only here and the add/edit controls are absent; Cardio stays editable.
- Deleting a group retires it (history keeps its name) rather than dropping it from the saved config; check `retired`, not absence.
