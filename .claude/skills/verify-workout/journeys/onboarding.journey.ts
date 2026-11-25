import { test, expect } from "./harness"

type SavedProfile = Record<string, unknown>

test("a new user answers onboarding, signs in with Google and lands on Home", { tag: "@onboarding" }, async ({ page, signIn, api, evidence, pageErrors }) => {
  // A brand-new visitor, signed out: /onboarding is public.
  await page.goto("/welcome")
  await page.getByRole("link", { name: "get started" }).click()
  await expect(page).toHaveURL(/\/onboarding$/)

  const next = page.getByRole("button", { name: "continue" })

  await expect(page.getByText("what do we call you?")).toBeVisible()
  await page.getByPlaceholder("Saif").fill("Verify")
  await evidence.shot(page, "action", "name")
  await next.click()

  await expect(page.getByText("how much do you weigh?")).toBeVisible()
  await page.getByPlaceholder("60").fill("82.5")
  // Weekly check-in is opted in by default; leave it on.
  await expect(page.getByRole("button", { name: /check in weekly/ })).toBeVisible()
  await next.click()

  // Two explainer steps (continue is live while they animate).
  await expect(page.getByText(/most people quit/)).toBeVisible()
  await next.click()
  await expect(page.getByText("the program has two parts.")).toBeVisible()
  await next.click()

  await expect(page.getByText("how do you want to train?")).toBeVisible()
  await expect(next).toBeDisabled()
  await page.getByRole("button", { name: /^lift-focused/ }).click()
  await evidence.shot(page, "action", "training-focus-lift-focused")
  await next.click()

  await expect(page.getByText("what lift are you training?")).toBeVisible()
  await page.getByRole("button", { name: "Bench Press" }).click()
  await next.click()

  await expect(page.getByText("how long have you been lifting?")).toBeVisible()
  await page.getByRole("button", { name: /^1–3 years/ }).click()
  await next.click()

  await expect(page.getByText("your main lift runs in 4-phase cycles.")).toBeVisible()
  await next.click()

  await expect(page.getByText(/current 1 rep max on bench press/)).toBeVisible()
  await page.getByPlaceholder("100").fill("90")
  await next.click()

  await expect(page.getByText("what's your goal weight?")).toBeVisible()
  // Suggestions are +10/20/30% of the 1RM, rounded to 2.5kg: 90 → 100kg is "+10%"... 99 rounds to 100.
  await page.getByRole("button", { name: /^100kg/ }).click()
  await expect(page.getByPlaceholder("140")).toHaveValue("100")
  await next.click()

  // Commitment gate: the Google button unlocks after a short beat.
  await expect(page.getByText("only do this if you're actually going to show up.")).toBeVisible()
  const google = page.getByRole("button", { name: "sign in with google" })
  await expect(google).toBeEnabled()
  await evidence.shot(page, "action", "sign-in-with-google")
  const googleRequest = page.waitForRequest((r) => new URL(r.url()).hostname === "accounts.google.com")
  await google.click()
  await googleRequest

  // The browser left for Google (blocked by the harness). Back on the app's origin, the
  // answers wait on the device for the OAuth round trip.
  await page.waitForLoadState()
  await page.goto("/welcome")
  const pending = await page.evaluate(() => localStorage.getItem("lift-tracker-pending-onboarding"))
  expect(JSON.parse(pending ?? "null")).toMatchObject({
    name: "Verify",
    bw: "82.5",
    mode: "lift-focused",
    lift: "bench",
    anchor: "90",
    target: "100",
    trainingAge: "some",
    weighInDaily: true,
  })

  // Google can't be completed here: stand in for its callback with a forged session for a
  // user who has NO profile yet, then follow Auth.js's callbackUrl back to onboarding.
  await signIn()
  api.seed("/api/profile", null)
  await page.goto("/onboarding?auth=1")

  // Onboarding saves the profile and sends the new user Home.
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole("button", { name: "Open profile" })).toContainText("hello, Verify")
  await expect(page.getByRole("meter", { name: /e1RM against the 100kg goal/ })).toBeVisible()
  await expect(page.getByRole("button", { name: "Log Session", exact: true })).toBeVisible()
  // Opted in to weekly check-ins with no weigh-in yet: Home asks for the first one.
  await expect(page.getByText("what did you weigh in at?")).toBeVisible()

  const saved = api.lastPost("/api/profile") as SavedProfile | undefined
  expect(saved).toMatchObject({
    name: "Verify",
    bw: 82.5,
    trainingMode: "lift-focused",
    mainLift: "bench",
    anchor: 90,
    target: 100,
    trainingAge: "some",
    weighInDaily: true,
  })
  evidence.json("saved-profile", saved)
  const local = await page.evaluate(() => ({
    profile: localStorage.getItem("lift-tracker-profile"),
    pending: localStorage.getItem("lift-tracker-pending-onboarding"),
  }))
  expect(JSON.parse(local.profile ?? "null")).toMatchObject({ name: "Verify", mainLift: "bench", target: 100 })
  expect(local.pending).toBeNull()
  await evidence.shot(page, "result", "home-after-onboarding")

  expect(pageErrors).toEqual([])
})
