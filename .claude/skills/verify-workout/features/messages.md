# Gymbro messages

Gymbros send each other short messages (one-tap roasts or a custom line): received ones show as an unread badge on Home's gymbros timeline and as an inbox panel on `/gymbros`; they are sent from the Home popup's Reply, a friend's profile (`Message`), and the hype panel that opens after confirming a session.

## Sub-features

- `msg-badge` shows an unread count on the sender's face on Home.
- `msg-popup` opens the sender's messages in a sheet and marks them read.
- `msg-reply` replies from that sheet with a custom line.
- `msg-inbox` lists all unread messages on `/gymbros`; `Dismiss messages` clears them.
- `msg-profile` sends a preset roast from a friend's profile (`Message`).
- `msg-hype` sends a roast from the post-session hype panel after confirming a session.

## How to get to it (user POV)

- Home → gymbros timeline → a face with a red badge.
- `/gymbros` → the dark `🔥 N messages` panel at the top.
- `/friends/<email>` → `Message`.
- Home → `Log Session` → finish and `Confirm Session` while having at least one gymbro.

## Driving it with Playwright (verify.mjs)

Preconditions:

- Signed in; fake seeded with `/api/friends` = `[Omar Example]`, `/api/presence` = Omar (not live), `/api/messages` = one message from Omar, `/api/friends/profile` = Omar's gymbro view.

- **Badge.** On `/`, `getByRole("button", { name: /^Omar Example, .*1 new message$/ })` is visible.
- **Open popup.** Click it. The sheet shows `gym's open btw. has been. all week.` and the fake recorded `DELETE /api/messages {"fromEmail":"omar@example.invalid"}`.
- **Reply.** Click `Reply 💬`, fill placeholder `or type your own...` with `verify-workout: on my way`, click `send`. `sent` shows; fake recorded `POST /api/messages/send {"toEmail":"omar@example.invalid","text":"verify-workout: on my way"}`. The sheet closes and Omar's face is a plain link again (no badge).
- **Inbox.** Seed `/api/messages` with one message from Lea and open `/gymbros`. `🔥 1 message` and the text show. Click `Dismiss messages`. The panel disappears, the fake recorded a body-less `DELETE /api/messages`, and after a reload the panel stays gone.
- **From a profile.** On `/friends/omar%40example.invalid` click `Message`, then the preset `go move something heavy`. `sent` shows; fake recorded the matching `POST /api/messages/send`.
- **Hype panel.** On `/`, click `Log Session`, complete every set and `Confirm Session`. A full-screen panel `roasting Omar` opens; click preset `your pr is older than this app`. Fake recorded `POST /api/messages/send {"toEmail":"omar@example.invalid","text":"your pr is older than this app"}`; three sends in total.
- **Run.** `node .claude/skills/verify-workout/verify.mjs run --feature messages`
- **Proof.** `messages/01-action-home-unread-badge.png`, `02-result-reply-sent.png`, `03-action-gymbros-inbox.png`, `04-result-gymbros-inbox-dismissed.png`, `05-action-profile-composer.png`, `06-action-hype-panel.png`, `07-result-hype-sent.png`, `video.webm`, `api-calls.json`.

## Gotchas

- Nothing is ever delivered: every send is answered by the in-browser fake, and the real route would also push-notify the recipient. Assert the request body, never a delivery.
- Home only shows faces for friends that are both in `/api/friends` and in `/api/presence`; seed both or the badge never appears.
- A face with unread messages is a button (opens the popup); without, it is a link to the profile. Match by role accordingly.
- The composer's header (`roasting …`) and the popup's `View Profile →` disappear once you compose or send; scope later assertions to a part that stays (the `1 message` header) or to `getByRole("dialog")`.
- The hype panel opens only after confirming a session with at least one gymbro (or a new e1RM PR); with exactly one gymbro they are preselected. Its presets fade in one by one; wait before screenshotting.
- The fake's `DELETE /api/messages` drops the whole inbox regardless of `fromEmail`, unlike the real route which keeps other senders' messages.
