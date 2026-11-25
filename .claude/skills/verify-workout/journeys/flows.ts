import type { Locator, Page } from "@playwright/test"
import { expect } from "./harness"

/** The session logger dialog (the nav drawer is a dialog too, so match the title). */
export function loggerDialog(page: Page): Locator {
  return page.getByRole("dialog").filter({ hasText: /Log Session \d+/ })
}

/**
 * Finish the logger that is already open: mark every set done (skipping rest timers),
 * write `note` and confirm. Same steps as e2e/flows.ts `logUpNextSession`, minus opening.
 */
export async function completeOpenLogger(page: Page, logger: Locator, note: string): Promise<void> {
  const confirm = logger.getByRole("button", { name: "Confirm Session" })
  const done = logger.getByRole("button", { name: "Done", exact: true })
  const skipRest = logger.getByRole("button", { name: "Skip rest" })
  for (let i = 0; i < 100 && !(await confirm.isVisible()); i++) {
    if (await skipRest.isVisible()) await skipRest.click()
    if (await done.isVisible()) await done.click()
    else await page.waitForTimeout(150)
  }
  await expect(logger.getByText("Session complete")).toBeVisible()
  await logger.getByPlaceholder("How did it feel?").fill(note)
  await confirm.click()
  await expect(logger).toBeHidden()
}
