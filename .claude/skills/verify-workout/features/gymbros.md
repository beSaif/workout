# Gymbros

Gymbros is the friends list: a user finds people by name, invites them by email, answers incoming friend requests, and removes a gymbro, all from `/gymbros`.

## Sub-features

- `gymbros-entry` opens `/gymbros` from Home's gymbros timeline (`+ add`) and from the menu.
- `gymbros-search` searches people by name and links each hit to their profile.
- `gymbros-invite` sends a friend request to an email address.
- `gymbros-accept` accepts an incoming request; the person joins the list.
- `gymbros-reject` rejects an incoming request; it leaves the pending list.
- `gymbros-remove` removes a gymbro after a confirmation sheet.

## How to get to it (user POV)

- Home → gymbros timeline → `+ add` (link `Add a gymbro`).
- Home → menu (`Open menu`) → `Gymbros`.
- The bell button `Friend requests` on `/gymbros` opens the pending-requests panel.

## Driving it with Playwright (verify.mjs)

Preconditions:

- Signed in (`signIn()`), with the fake seeded: `/api/friends` = one gymbro (`Lea Placeholder`), `/api/friends/requests` = requests from `omar@example.invalid` and `ray@example.invalid`, `/api/users/search` = `[Omar Example]`.
- The journey models the friend graph as a tiny stateful server (`page.route` + `route.fallback()` re-seeds the fake before each request), so accept/reject/remove show up on the UI's own re-fetch.

- **Open.** Choose `+ add` on Home. `getByRole("link", { name: "Add a gymbro" })`. URL is `/gymbros`, heading `Gymbros`, count `1 gymbro`.
- **Search by name.** Type `omar` into `getByRole("textbox", { name: "Search by name or add by email" })`. A request `GET /api/users/search?q=omar` goes out and link `Omar Example` points to `/friends/omar%40example.invalid`.
- **Invite by email.** Type `newbie@example.invalid`; an `Add` button appears. Click it. `Request sent` shows and the fake recorded `POST /api/friends/request {"targetEmail":"newbie@example.invalid"}`.
- **Accept.** Click `Friend requests`, then `Accept` in the row containing `omar@example.invalid`. Count becomes `2 gymbros`; fake recorded `POST /api/friends/accept {"requesterEmail":"omar@example.invalid"}`.
- **Reject.** Click `Reject` in Ray's row. `No pending requests` shows; fake recorded `POST /api/friends/reject {"requesterEmail":"ray@example.invalid"}`.
- **Remove.** Click `Remove Lea Placeholder`, then `Remove gymbro` in the sheet titled `Remove Lea Placeholder?`. Count returns to `1 gymbro`, Lea's link is gone, and the fake recorded exactly one `DELETE /api/friends {"friendEmail":"lea@example.invalid"}`.
- **Run.** `node .claude/skills/verify-workout/verify.mjs run --feature gymbros`
- **Proof.** `gymbros/01-action-search-by-name.png`, `02-result-request-sent.png`, `03-action-pending-requests.png`, `04-result-accepted-omar-rejected-ray.png`, `05-action-remove-confirm.png`, `06-result-lea-removed.png`, `video.webm`, and `api-calls.json` (every request body above).

## Gotchas

- One field does two jobs: anything containing `@` is an invitation (no search fires), anything else of two or more characters searches after a 250 ms debounce. Wait for the search request, not a fixed sleep.
- The in-memory fake answers every write with `{ ok: true }` and does not know the friend graph; without the journey's stateful re-seeding, accept would not add anyone and a `DELETE /api/friends` would wipe the whole list.
- The fake ignores query strings: `/api/users/search` returns its seed for any `q`.
- Real-server error answers (`user not found`, `already friends`, `request already sent`, `cannot add yourself`) each map to a message under the field; the journey only covers the success path.
- Accepting or requesting sends a push to the other person server-side; with the fake nothing is sent.
