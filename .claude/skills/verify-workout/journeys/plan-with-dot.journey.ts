import { test, expect } from "./harness"

type Day = { id: string; name: string; muscleGroupIds: string[] }
type Group = { id: string; name: string; retired?: boolean; exercises: { name: string }[] }

// What a user's own chatbot sends back: prose around a fenced JSON plan.
const PASTED_PLAN = {
  version: 1,
  groups: [
    { id: "chest", name: "Chest", exercises: [{ name: "Incline Dumbbell Press", sets: 3 }] },
    { id: "back", name: "Back", exercises: [{ name: "Lat Pulldown", sets: 3 }, { name: "Seated Cable Row", sets: 3 }] },
    { id: "legs", name: "Legs", exercises: [{ name: "Back Squat", sets: 3 }] },
    { name: "Glutes", exercises: [{ name: "Hip Thrust", sets: 3 }] },
  ],
  days: [
    { id: "day-a", name: "Upper", groups: ["chest", "back"] },
    { name: "Lower", groups: ["legs", "Glutes"] },
  ],
}

// What Dot (the /api/plan LLM route) answers, in the route's real response shape.
const DOT_PLAN = {
  version: 1,
  groups: [
    { id: "chest", name: "Chest", exercises: [{ name: "Incline Dumbbell Press", sets: 3 }] },
    { id: "back", name: "Back", exercises: [{ name: "Lat Pulldown", sets: 3 }] },
    { id: "shoulders", name: "Shoulders", exercises: [{ name: "Lateral Raise", sets: 3 }] },
    { id: "legs", name: "Legs", exercises: [{ name: "Leg Press", sets: 3 }] },
  ],
  days: [
    { id: "day-a", name: "Push Pull", groups: ["chest", "back", "shoulders"] },
    { id: "day-b", name: "Legs Day", groups: ["legs"] },
  ],
}

test("plan the routine with your own AI and with Dot, preview, apply and undo", { tag: "@plan-with-dot" }, async ({ page, context, signIn, api, evidence, pageErrors }) => {
  await signIn()
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  // Dot is configured with 5 plans left today (the fake's default says unavailable).
  api.seed("/api/plan", { available: true, remaining: 5, limit: 5, following: false, athleteCount: 0 })
  // POST /api/plan is the LLM call. The fake answers it like the route does when a
  // planner is configured. (Patched on the FakeApi rather than a page.route: apiGuard
  // counts only requests the context-level fake answered as safe.)
  const dotRequests: unknown[] = []
  const respond = api.respond.bind(api)
  api.respond = (method, path, body) => {
    if (method !== "POST" || path !== "/api/plan") return respond(method, path, body)
    api.calls.push({ method, path, body })
    dotRequests.push(body)
    return { status: 200, json: { plan: DOT_PLAN, warnings: [], remaining: 4 } }
  }

  const days = () => (api.lastPost("/api/training-days") as Day[] | undefined)?.map((d) => d.name)
  // Live (not retired) groups; the Cardio library is never part of a plan and always stays.
  const live = () => (api.lastPost("/api/exercises") as Group[] | undefined)?.filter((g) => !g.retired).map((g) => g.name).sort()

  // Entry: Routine → Plan with Dot.
  await page.goto("/exercises")
  await page.getByRole("link", { name: /^Plan with Dot/ }).click()
  await expect(page).toHaveURL(/\/plan$/)
  await expect(page.getByRole("heading", { level: 1, name: "Plan your routine" })).toBeVisible()
  await expect(page.getByRole("button", { name: /^Plan with Dot .*5 of 5 plans left today/ })).toBeVisible()

  // ── (a) Use your own AI: copy the prompt, paste a plan back.
  await page.getByRole("button", { name: /^Use your own AI/ }).click()
  await page.getByRole("button", { name: "Copy prompt" }).click()
  await expect(page.getByRole("button", { name: "Copied ✓" })).toBeVisible()
  const prompt = await page.evaluate(() => navigator.clipboard.readText())
  expect(prompt).toContain("My current routine:")
  expect(prompt).toContain('"Lat Pulldown"')
  evidence.json("copied-prompt", { prompt })

  const reply = `Here's your new split!\n\n\`\`\`json\n${JSON.stringify(PASTED_PLAN, null, 2)}\n\`\`\`\nEnjoy.`
  await page.getByRole("textbox", { name: "Plan to import" }).fill(reply)
  await evidence.shot(page, "action", "paste-own-ai-plan")
  await page.getByRole("button", { name: "Check plan" }).click()

  // Preview: what changes, before anything is saved.
  await expect(page.getByText("What changes")).toBeVisible()
  await expect(page.getByText("Day A, Day B, Day C → Upper, Lower")).toBeVisible()
  await expect(page.getByText("Glutes", { exact: true }).first()).toBeVisible()
  expect(api.lastPost("/api/training-days")).toBeUndefined()
  await evidence.shot(page, "result", "own-ai-preview")

  await page.getByRole("button", { name: "Use this plan" }).click()
  await expect(page.getByRole("link", { name: "See my routine" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Undo, put my old routine back" })).toBeVisible()
  await expect.poll(days).toEqual(["Upper", "Lower"])
  await expect.poll(live).toEqual(["Back", "Cardio", "Chest", "Glutes", "Legs"])
  evidence.json("applied-own-ai", { exercises: api.lastPost("/api/exercises"), trainingDays: api.lastPost("/api/training-days") })
  await evidence.shot(page, "result", "own-ai-applied-undo-offered")

  // Undo puts the old routine back.
  await page.getByRole("button", { name: "Undo, put my old routine back" }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Restore routine" }).click()
  await expect.poll(days).toEqual(["Day A", "Day B", "Day C"])
  await expect(page.getByRole("button", { name: /^Use your own AI/ })).toBeVisible()

  // ── (b) Plan with Dot: five questions, one /api/plan call, preview, apply.
  await page.getByRole("button", { name: /^Plan with Dot/ }).click()
  const answer = async (question: string, option: string) => {
    const block = page.locator("div").filter({ has: page.getByText(question, { exact: true }) }).last()
    await block.getByRole("button", { name: option, exact: true }).click()
  }
  const make = page.getByRole("button", { name: "Make my plan" })
  await answer("How many days a week do you train?", "2")
  await answer("How long can a session be?", "1 hour")
  await answer("What can you train with?", "Full gym")
  await expect(make).toBeDisabled()
  await answer("What are you after?", "Get stronger")
  await answer("How long have you been lifting?", "1–3 years")
  await page.getByPlaceholder(/Injuries, exercises to keep or avoid/).fill("keep lat pulldowns")
  await expect(make).toBeEnabled()
  await evidence.shot(page, "action", "dot-questions-answered")
  await make.click()

  await expect(page.getByText("What changes")).toBeVisible()
  await expect(page.getByText("Day A, Day B, Day C → Push Pull, Legs Day")).toBeVisible()
  await expect(page.getByText("4 left today")).toBeVisible()
  expect(dotRequests).toEqual([
    { answers: { daysPerWeek: "2", minutes: "60", equipment: "gym", goal: "strength", experience: "some", note: "keep lat pulldowns" } },
  ])
  await evidence.shot(page, "result", "dot-preview")

  await page.getByRole("button", { name: "Use this plan" }).click()
  await expect.poll(days).toEqual(["Push Pull", "Legs Day"])
  await page.getByRole("link", { name: "See my routine" }).click()
  await expect(page).toHaveURL(/\/exercises$/)
  await expect(page.getByRole("button", { name: "Push Pull Chest, Back, Shoulders" })).toBeVisible()
  await expect(page.getByRole("button", { name: /^Legs Day Legs/ })).toBeVisible()
  evidence.json("applied-dot", { dotRequests, exercises: api.lastPost("/api/exercises"), trainingDays: api.lastPost("/api/training-days") })
  await evidence.shot(page, "result", "routine-after-dot-plan")

  expect(pageErrors).toEqual([])
})
