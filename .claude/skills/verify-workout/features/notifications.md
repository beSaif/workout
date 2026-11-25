# Push notifications

Push notifications let a user allow alerts (friend requests, weigh-in reminders, time-off nudges); Home asks with a banner and, once allowed, registers the device's push subscription with the server.

## Sub-features

- `notif-banner` shows `Enable notifications for friend requests` on Home while the browser has not been asked yet.
- `notif-dismiss` hides the banner for the current visit (`Dismiss`).
- `notif-enable` asks for permission and, when allowed, sends the push subscription and time zone to the server.
- `notif-refresh` re-sends the subscription on later visits once permission is granted, with no banner.
- Delivery of reminders (daily cron) is server-side and out of scope here.

## How to get to it (user POV)

- Home, on a device that has not answered the browser's notification prompt: the banner under the gymbros row → `Enable`.

## Driving it with Playwright (verify.mjs)

Preconditions:

- The target was built with `NEXT_PUBLIC_VAPID_PUBLIC_KEY` set (a public key, inlined at build time). Without it the banner never renders and the journey fails at the first step, by design.
- The journey file sets `serviceWorkers: "allow"`; an init script stands in for the browser permission prompt (`default` until asked, then `granted`) and the browser push service (a fixed subscription with endpoint `https://push.example.invalid/verify-workout`).

- **Banner.** Signed in, open `/`. Text `Enable notifications for friend requests` is visible.
- **Dismiss.** Click button `Dismiss` (the banner's close). The banner hides; after a reload it is back.
- **Enable.** Click button `Enable`. The banner hides, `Notification.permission` is `granted`, and the last `/api/push/subscribe` POST has `subscription.endpoint` = the fake endpoint and a non-empty `tz`.
- **Refresh.** Reload. No banner; another `/api/push/subscribe` POST arrives.
- **Run.** `node .claude/skills/verify-workout/verify.mjs run --feature notifications`
- **Proof.** `notifications/01-action-notification-banner.png`, `02-result-home-notifications-on.png`, `push-subscribe-body.json`, `api-calls.json`, `video.webm`.

## Gotchas

- `verify.mjs launch` builds with a fixed throwaway `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (no private key exists for it), so the local target meets this precondition. A local build made some other way (plain `pnpm build`) has none and this journey fails at the banner. Previews get the real key from Vercel.
- Headless Chromium reports `Notification.permission === "denied"` and never prompts, so without the stand-in the banner can never appear.
- The real push service is external (FCM); subscribing for real would leave the VM, so it is replaced at that boundary. What is proven is the app's request to `/api/push/subscribe`, not delivery.
- On iOS the browser only allows the permission request from a tap, which is why the banner exists; that path needs a real iPhone in standalone mode.
- Granted permission skips the banner entirely, so start each run from a fresh context.
