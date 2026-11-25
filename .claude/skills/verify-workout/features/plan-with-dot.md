# Plan with Dot

Plan with Dot rewrites the user's routine (training days, muscle groups, exercises) from a plan written by an AI. Either Dot drafts it from five tap-to-answer questions, or the user copies a prompt into their own chatbot and pastes the reply back. Either way the plan is previewed with a summary of what changes, nothing is saved until the user applies it, and the previous routine can be restored for a week.

## Sub-features

- `plan-entry` opens the planner from the Routine page and shows how many Dot plans are left today.
- `plan-copy` copies a prompt carrying the current routine and the format rules.
- `plan-paste` reads a pasted reply (prose, code fences and curly quotes tolerated) and reports problems it can't use.
- `plan-dot` asks five questions plus an optional note and sends them to Dot, with a daily limit and a "Not quite?" tweak.
- `plan-preview` shows "What changes" (days, new/retired groups, new/dropped exercises) and the new routine before anything is saved.
- `plan-apply` saves the new routine; dropped groups are retired, not deleted.
- `plan-undo` puts the previous routine back ("Undo, put my old routine back" / "Undo the last plan you applied").

## How to get to it (user POV)

- Menu → Exercise Selection (`/exercises`) → the `Plan with Dot` card → `/plan` (heading "Plan your routine").
- On `/plan`: `Plan with Dot` (only when the planner is configured) or `Use your own AI`.

## Driving it with Playwright (verify.mjs)

Preconditions:

- Signed in with the onboarded profile and the default routine.
- The fake answers `GET /api/plan` with `{ available: true, remaining: 5, limit: 5, following: false, athleteCount: 0 }` (seeded) and `POST /api/plan` with `{ plan, warnings: [], remaining: 4 }` (the journey patches `api.respond`). No LLM is ever called.
- Clipboard permissions granted to the context (Chromium).

- **Open.** On `/exercises` click link `Plan with Dot…`; URL `/plan`, h1 `Plan your routine`, a button `Plan with Dot … 5 of 5 plans left today`.
- **Copy the prompt.** Click `Use your own AI`, then `Copy prompt`; the button reads `Copied ✓` and the clipboard holds `My current routine:` with `"Lat Pulldown"`.
- **Paste a plan.** Fill textbox `Plan to import` with prose plus a ```json fenced plan (Upper: chest+back, Lower: legs + new Glutes), click `Check plan`. `What changes` shows `Day A, Day B, Day C → Upper, Lower` and `Glutes`; no `POST /api/training-days` yet.
- **Apply.** Click `Use this plan`. Link `See my routine` and button `Undo, put my old routine back` show; saved days are `Upper, Lower`, live groups `Back, Cardio, Chest, Glutes, Legs`.
- **Undo.** Click `Undo, put my old routine back`, confirm `Restore routine` in the `alertdialog`; saved days are `Day A, Day B, Day C` again.
- **Ask Dot.** Click `Plan with Dot…`, pick `2`, `1 hour`, `Full gym`, `Get stronger`, `1–3 years` under their questions (`Make my plan` stays disabled until all five are answered), fill the `Injuries, exercises to keep or avoid…` note, click `Make my plan`. The request body is `{ answers: { daysPerWeek: "2", minutes: "60", equipment: "gym", goal: "strength", experience: "some", note } }`; the preview shows `Day A, Day B, Day C → Push Pull, Legs Day` and `4 left today`.
- **Apply Dot's plan.** Click `Use this plan`, then `See my routine`: `/exercises` lists `Push Pull` (Chest, Back, Shoulders) and `Legs Day`.
- **Run.** `node .claude/skills/verify-workout/verify.mjs run --feature plan-with-dot`
- **Proof.** `plan-with-dot/01-action-paste-own-ai-plan.png`, `02-result-own-ai-preview.png`, `03-result-own-ai-applied-undo-offered.png`, `04-action-dot-questions-answered.png`, `05-result-dot-preview.png`, `06-result-routine-after-dot-plan.png`, `copied-prompt.json`, `applied-own-ai.json`, `applied-dot.json`, `api-calls.json`, `video.webm`.

## Gotchas

- The `Plan with Dot` button only appears when `GET /api/plan` says `available: true`; the fake's default is unavailable, so seed it. On a real preview without `PLANNER_API_KEY` only `Use your own AI` is offered.
- Answer `POST /api/plan` through the FakeApi (patch `api.respond`), not `page.route`: the apiGuard fixture counts any data-API request the context-level fake did not answer as a leak and fails the journey.
- The Cardio library is never part of a plan and always stays live; retired groups remain in the saved config with `retired: true`.
- `Prompt to copy` (a read-only textbox) only appears when the clipboard write fails; with permissions granted, read the clipboard instead.
- Undo is offered for 7 days and only on the device that applied the plan (the snapshot lives in localStorage).
- When the account trains under a coach the planner is locked; when athletes train under the user, applying asks for confirmation first.
