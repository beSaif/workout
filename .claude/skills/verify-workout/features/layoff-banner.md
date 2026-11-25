# Layoff banner

After time off, Home warns above the progress card: from 7 days a nudge (`N days since your last session`, dismiss with ×), from 14 days a restart offer (`N weeks since…`) with `Restart <Phase>` (the active block from session 1 at its peak eased 5%) and `Keep going`. A dismissal holds for that tier only.

## Sub-features

- `layoff-nudge` 7–13 days off: advice only, dismissed with `Dismiss`.
- `layoff-restart-offer` 14+ days off with sessions in the block: `Restart <Phase>` and `Keep going`.
- `layoff-dismiss` hides the banner until the tier changes, across reloads.
- `layoff-restart` restarts the active block at the eased peak; logged sessions stay in history, unlinked.

## How to get to it (user POV)

- Open Home after a week or more without a confirmed session (lift-focused mode only).

## Driving it with Playwright (verify.mjs)

Preconditions:

- Signed in with the onboarded bench profile, nothing logged.
- The browser clock is moved with `page.clock.setFixedTime` to log a session 21 days ago and come back later; the server clock is untouched.

- **Log in the past.** Set the clock 21 days back, open `/`, log `Log Session` through the logger. No banner shows.
- **Nudge.** Set the clock 10 days after that, reload. `10 days since your last session` shows, with no `Restart Accumulation`. Choose the main region's `Dismiss`; localStorage `lift-tracker-layoff-dismissed` ends `:nudge`.
- **Restart offer.** Set the clock to now, reload. `3 weeks since your last session` shows with `Restart Accumulation` and `Keep going`.
- **Keep going.** Choose `Keep going`. The banner hides, the flag ends `:restart`, and it stays hidden after a reload.
- **Restart.** Clear the flag, reload, choose `Restart Accumulation`. `alertdialog "Restart Accumulation from session 1?"` names the eased peak; choose `Restart block`.
- **Restart saved.** The saved active block has `anchorWeight` = the eased peak and `sessionIds: []`; the old session is confirmed without `blockId`; the pill reads `This cycle peaks at <eased>kg · Manage`; no banner.
- **Run.** `node .claude/skills/verify-workout/verify.mjs run --feature layoff-banner`
- **Proof.** `layoff-banner/01-action-nudge-banner.png`, `02-action-layoff-banner.png`, `03-result-dismissed-after-reload.png`, `05-result-restarted-block.png`, `blocks-after-restart.json`, `api-calls.json`, `video.webm`.

## Gotchas

- The phase is named by its long label: `Restart Accumulation`, not `Restart Volume`.
- With 14+ days off but nothing logged in the active block, no restart is offered, only advice with a × dismiss.
- Home also has a notifications banner with a `Dismiss` button; scope the nudge's to the banner text or the main region and check which one is visible.
- Banner copy renders `Accumulationfrom` without a space (app copy bug).
