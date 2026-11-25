# Training day and extras on the up-next session

In Main Lift mode the up-next session card names the training day whose accessories follow the main lift. Dot picks it ("Coach pick") from the rotation, and the user can switch to another day or add extra muscle groups for this session only. The main lift still opens the session; the chosen day and extras decide which accessories the logger adds after it.

## Sub-features

- `day-coach-pick` shows the recommended training day with a `Coach pick` badge.
- `day-switch` swaps the up-next session to another training day from an inline list.
- `extras-add` adds muscle groups not already in the day for this session only and shows them on the card ("1 extra").
- `extras-log` logs the session with the main lift first and the day's plus the extra muscles' exercises after it.

## How to get to it (user POV)

- Home (`/`, Main Lift mode) → the `Up next` session card → `Training Day` row → `Switch day` or `+ Extras`.
- The same controls exist on the Balanced home's Up next card.

## Driving it with Playwright (verify.mjs)

Preconditions:

- Signed in with the onboarded lift-focused bench profile, default routine, no sessions (Day A is the coach's pick).
- `verify.mjs doctor` is green.

- **Coach pick.** On `/` the card shows `Training Day`, `Back + Triceps` and `Coach pick`.
- **Switch day.** Click `Switch day`, then the button `Day B Chest + Biceps…`. The card shows `Chest + Biceps` and no `Coach pick`.
- **Add an extra.** Click `+ Extras`; `Add for this session only` appears with no `Chest` checkbox (already in the day). Check `getByRole("checkbox", { name: "Shoulders" })`, click `Save` (exact). The button now reads `1 extra` and the day line reads `Chest + Biceps + Shoulders`.
- **Log it.** Click `Log Session` (exact); the logger opens on `Bench Press`. Complete it with `completeOpenLogger`. The last `POST /api/sessions` holds one confirmed session with working main-lift sets, `selectedTrainingDayId: "day-b"`, `selectedMuscleGroups: ["chest", "biceps", "shoulders"]` and `extraWorkouts` for those three muscles.
- **Home after.** `Logged this block` and `Session 1` show.
- **Run.** `node .claude/skills/verify-workout/verify.mjs run --feature training-day-extras`
- **Proof.** `training-day-extras/01-action-switch-day-picker.png`, `02-action-extras-shoulders.png`, `03-result-up-next-day-b-plus-shoulders.png`, `04-result-home-after-logging-day-b.png`, `saved-session.json`, `api-calls.json`, `video.webm`.

## Gotchas

- `Switch day` and `+ Extras` toggle to `Close` while their panel is open; a second click on the same locator name fails.
- Switching day clears extras already picked; pick the day first, then extras.
- Extras are for this session only: the next up-next card goes back to the rotation.
- `Coach pick` here is Dot's recommendation and makes no request; `/api/coach` belongs to "train under a friend" on the friend profile, not to this card.
- The main lift opens the session whatever day is chosen; only `Skip Bench` removes it.
