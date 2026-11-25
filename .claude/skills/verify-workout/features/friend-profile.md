# Friend profile

A gymbro's profile at `/friends/<email>` shows their card (rarity, counts, live presence, best e1RM, records, streak, last session), their routine, and lets the viewer hype a record, message them, or train under them.

## Sub-features

- `profile-open` opens a friend's profile from the gymbros list, Home's timeline, or a search hit.
- `profile-card` shows name, lift and rarity pills, `In session` when live, session/gymbro/athlete counts, records, streak and the last session.
- `profile-hype` sends a one-time hype for a record (tap the record row).
- `profile-routine` shows their training days and, on tap, each day's exercises.
- `profile-train-under` replaces the viewer's routine with theirs after a warning sheet; the button becomes `Training under ✓`.
- `profile-add` on a non-gymbro's profile, `Add gymbro` sends a friend request (not driven; see Gotchas).

## How to get to it (user POV)

- `/gymbros` → tap a gymbro's name.
- Home → gymbros timeline → tap a friend's face (when they have no unread messages).
- `/gymbros` search → tap a result.

## Driving it with Playwright (verify.mjs)

Preconditions:

- Signed in; fake seeded with `/api/friends` = `[Omar Example]`, `/api/friends/profile` = Omar's gymbro view (12 sessions, 4 gymbros, 1 athlete, records `Bench Press 95kg × 1` and `Incline Press`, routine `Push Day` → `Chest` → `Incline Press`), `/api/presence` = Omar in session.
- `PUT /api/coach` answered with Omar's summary and routine (`answer()` in `journeys/social.ts`).

- **Open.** On `/gymbros` click link `Omar Example`. URL is `/friends/omar%40example.invalid`, heading `Omar Example`.
- **Card.** `getByLabel("In session")` (green dot) and the `In session` pill are visible, `Session 12 · Chest` shows, tab `Stats` is selected, hint `tap a record to hype it` shows.
- **Hype a record.** Click `getByRole("button", { name: /^Bench Press 1 rep/ })`. The row disables and the fake recorded `POST /api/messages/send {"toEmail":"omar@example.invalid","text":"🔥 Bench Press 95kg × 1 — nasty"}`.
- **Routine.** Click tab `Routine`, then the day button `Push Day 1 exercise …`. `Incline Press` shows.
- **Train under.** Click `Train under Omar`; a sheet with `Your routine will be replaced` opens; click its `Train under Omar`. The header button reads `Training under ✓`, the fake recorded `PUT /api/coach {"email":"omar@example.invalid"}`, the Routine tab says `You train under Omar, so this is your routine too.`, and localStorage `lift-tracker-training-days` holds `Push Day`.
- **Run.** `node .claude/skills/verify-workout/verify.mjs run --feature friend-profile`
- **Proof.** `friend-profile/01-action-friend-card.png`, `02-result-record-hyped.png`, `03-result-routine-tab.png`, `04-action-train-under-warning.png`, `05-result-training-under-omar.png`, `video.webm`, `api-calls.json`, `local-storage.json`.

## Gotchas

- The profile endpoint and every card number are server-computed; the journey's seed is hand-made and must match the shape of `/api/friends/profile` (profile, lastSessionSummary, card, social, routine). If the page shows `No profile found`, the seed is missing or malformed.
- The fake answers non-GET writes with `{ ok: true }`; `Train under` needs the real response shape (`coach`, `config`, `trainingDays`) or the page throws. Use `answer(api, "PUT", "/api/coach", …)`, not a fulfilling `page.route` (apiGuard would fail the journey as a leaked request).
- Hype only exists for gymbros (`social.isFriend`); on a stranger's profile the primary button is `Add gymbro` and records are not tappable. That path is not driven yet.
- Record rows are one button each whose name concatenates exercise, reps, date and kg; match with a leading regex.
- Day buttons in the Routine tab start collapsed; exercises appear only after tapping the day.
