import { describe, expect, it } from "vitest"
import fc from "fast-check"
import {
  PLAN_LIMITS,
  PLAN_VERSION,
  exportPlan,
  extractPlanJson,
  parsePlan,
  readPlanText,
  resolvePlan,
  type RoutinePlan,
} from "./routinePlan"
import { PLAN_NOTE_MAX, PLAN_QUESTIONS, buildCopyPrompt, buildRepairMessages, parsePlanAnswers } from "./planPrompt"
import { DEFAULT_CARDIO_GROUP, DEFAULT_MUSCLE_GROUPS, DEFAULT_TRAINING_DAYS } from "./exerciseConfig"

const RUNS = { numRuns: 200 }

// ─── Well-formed plans ────────────────────────────────────────────────────────

const GROUP_WORDS = ["Chest", "Back", "Quads", "Hamstrings", "Glutes", "Shoulders", "Biceps", "Triceps", "Calves", "Core", "Upper Back", "Rear Delts"]
const EXERCISE_WORDS = ["Incline Dumbbell Press", "Lat Pulldown", "Romanian Deadlift", "Cable Lateral Raise", "Leg Press", "Hip Thrust", "Face Pull", "Hammer Curl", "Skull Crusher", "Pull-up", "Dips", "Calf Raise"]
const DAY_WORDS = ["Push", "Pull", "Legs", "Upper", "Lower", "Full Body", "Arms"]

/** Distinct names: a word and its position, so no two normalise to the same key. */
const names = (pool: string[], min: number, max: number) =>
  fc.array(fc.constantFrom(...pool), { minLength: min, maxLength: max }).map((ws) => ws.map((w, i) => `${w} ${i + 1}`))

const planArb: fc.Arbitrary<RoutinePlan> = fc
  .record({
    groupNames: names(GROUP_WORDS, 1, 8),
    exercises: fc.array(fc.tuple(names(EXERCISE_WORDS, 0, 5), fc.array(fc.option(fc.integer({ min: 1, max: 10 }), { nil: undefined }), { minLength: 5, maxLength: 5 })), { minLength: 8, maxLength: 8 }),
    groupIds: fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
    dayNames: names(DAY_WORDS, 1, 7),
    dayPicks: fc.array(fc.array(fc.nat(), { maxLength: 4 }), { minLength: 7, maxLength: 7 }),
    dayIds: fc.array(fc.boolean(), { minLength: 7, maxLength: 7 }),
    byId: fc.boolean(),
  })
  .map(({ groupNames, exercises, groupIds, dayNames, dayPicks, dayIds, byId }) => {
    const groups = groupNames.map((name, i) => ({
      ...(groupIds[i] ? { id: `grp-${i}` } : {}),
      name,
      exercises: exercises[i][0].map((ex, j) => (exercises[i][1][j] === undefined ? { name: ex } : { name: ex, sets: exercises[i][1][j] })),
    }))
    const days = dayNames.map((name, i) => ({
      ...(dayIds[i] ? { id: `day-${i}` } : {}),
      name,
      groups: [...new Set(dayPicks[i].map((k) => k % groups.length))].map((k) => (byId && groups[k].id) || groups[k].name),
    }))
    return { version: PLAN_VERSION, groups, days }
  })

/** What parsing a plan settles on: days point at a group's id when it has one, else its name. */
function normalised(plan: RoutinePlan): RoutinePlan {
  const key = (ref: string) => {
    const g = plan.groups.find((x) => x.id === ref || x.name === ref)!
    return g.id ?? g.name
  }
  return { ...plan, days: plan.days.map((d) => ({ ...d, groups: d.groups.map(key) })) }
}

/** Every way a chatbot's reply, or a phone's clipboard, has been seen to dress a plan up. */
const dressings: Record<string, (json: string) => string> = {
  bare: (j) => j,
  "json fence with prose": (j) => `Here's your new routine:\n\n\`\`\`json\n${j}\n\`\`\`\n\nLet me know if you'd like changes!`,
  "plain fence": (j) => "```\n" + j + "\n```",
  "prose around a bare object": (j) => `Sure. ${j} Enjoy the program.`,
  "curly quotes": (j) => {
    let open = true
    return j.replace(/"/g, () => ((open = !open) ? "”" : "“"))
  },
  "trailing commas": (j) => j.replace(/\]/g, ",]").replace(/\}/g, ",}").replace(/\[,\]/g, "[]").replace(/\{,\}/g, "{}"),
  "wrapped in plan": (j) => `{"plan": ${j}}`,
  "curly quotes in a fence": (j) => "```json\n" + j.replace(/"/g, "“") + "\n```",
}

describe("readPlanText", () => {
  for (const [label, dress] of Object.entries(dressings)) {
    it(`reads a well-formed plan: ${label}`, () => {
      fc.assert(
        fc.property(planArb, fc.boolean(), (plan, pretty) => {
          const result = readPlanText(dress(JSON.stringify(plan, null, pretty ? 2 : undefined)))
          expect(result.ok).toBe(true)
          if (result.ok) expect(result.plan).toEqual(normalised(plan))
        }),
        { numRuns: 60 }
      )
    })
  }

  it("takes the stored routine's own field names", () => {
    fc.assert(
      fc.property(planArb, (plan) => {
        const stored = {
          muscleGroups: plan.groups.map((g) => ({ ...g, exercises: g.exercises.map((e) => ({ name: e.name, defaultSets: e.sets })) })),
          trainingDays: plan.days.map(({ groups, ...d }) => ({ ...d, muscleGroupIds: groups })),
        }
        const result = readPlanText(JSON.stringify(stored))
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.plan).toEqual(normalised(plan))
      }),
      { numRuns: 60 }
    )
  })

  it("never throws on arbitrary text, and always says why when it can't read it", () => {
    const fragments = fc.constantFrom("{", "}", "[", "]", "```", "```json\n", '"groups":', '"days":', ",", "“", "”", "\n", "null", ":")
    const text = fc.oneof(
      fc.string({ unit: "binary" }),
      fc.array(fc.oneof(fragments, fc.string()), { maxLength: 30 }).map((xs) => xs.join("")),
      fc.jsonValue().map((v) => JSON.stringify(v))
    )
    fc.assert(
      fc.property(text, (t) => {
        const result = readPlanText(t)
        if (!result.ok) {
          expect(result.errors.length).toBeGreaterThan(0)
          expect(result.errors.length).toBeLessThanOrEqual(8)
          result.errors.forEach((e) => expect(e).toEqual(expect.any(String)))
        }
      }),
      { numRuns: 500 }
    )
  })

  it("never throws on any value a JSON parse could hand it", () => {
    fc.assert(
      fc.property(fc.oneof(fc.anything(), fc.jsonValue(), fc.record({ groups: fc.anything(), days: fc.anything() })), (v) => {
        expect(() => parsePlan(v)).not.toThrow()
      }),
      { numRuns: 500 }
    )
  })

  it("survives a plan truncated anywhere, as a reply cut off mid-stream", () => {
    fc.assert(
      fc.property(planArb, fc.double({ min: 0, max: 1, noNaN: true }), (plan, at) => {
        const json = JSON.stringify(plan)
        const cut = json.slice(0, Math.floor(json.length * at))
        expect(() => readPlanText(cut)).not.toThrow()
      }),
      RUNS
    )
  })

  it("says so when nothing, or nothing JSON, was pasted", () => {
    expect(extractPlanJson("   ")).toEqual({ ok: false, error: "Nothing was pasted." })
    expect(extractPlanJson("Here is your plan!").ok).toBe(false)
  })

  it("skips a ``` and a { mentioned in prose before the real fenced block", () => {
    fc.assert(
      fc.property(planArb, fc.boolean(), (plan, pretty) => {
        const text = [
          'Sent as a ```json block, shaped like {"groups": [...]}:',
          "",
          "```json",
          JSON.stringify(plan, null, pretty ? 2 : undefined),
          "```",
        ].join("\n")
        const result = readPlanText(text)
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.plan).toEqual(normalised(plan))
      }),
      { numRuns: 60 }
    )
  })

  it("takes the last plan in the text, past JSON fragments that aren't plans", () => {
    fc.assert(
      fc.property(planArb, planArb, (older, newer) => {
        const text = `Before: ${JSON.stringify(older)}\n\nAfter:\n${JSON.stringify(newer, null, 2)}\n\nEach exercise looks like {"name": "Dips", "sets": 3}.`
        const result = readPlanText(text)
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.plan).toEqual(normalised(newer))
      }),
      { numRuns: 60 }
    )
  })

  it("when no candidate is a plan, says why: cut off, not a plan, or no JSON at all", () => {
    const cutOff = (json: string) => "Here you go:\n\n```json\n" + json.slice(0, Math.floor(json.length / 2))
    fc.assert(
      fc.property(planArb, (plan) => {
        expect(readPlanText(cutOff(JSON.stringify(plan, null, 2)))).toEqual({
          ok: false,
          errors: ["That JSON doesn't parse. It may have been cut off — copy the whole reply and try again."],
        })
      }),
      { numRuns: 60 }
    )
    // A parsable object that isn't a plan is handed on so the reply hears what's missing,
    // even with a smaller non-plan fragment after it.
    expect(readPlanText('```json\n{"groups": []}\n```\nFor example {"sets": 3}.')).toEqual({
      ok: false,
      errors: ['"groups" must be a non-empty list of muscle groups.'],
    })
    expect(readPlanText("No braces here, just a ```code``` mention.")).toEqual({
      ok: false,
      errors: ["There's no JSON in that. Paste the reply that starts with { and ends with }."],
    })
  })
})

describe("parsePlan limits", () => {
  it("clamps any numeric sets to a whole number of 1–10", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (sets) => {
        const result = parsePlan({ groups: [{ name: "Chest", exercises: [{ name: "Fly", sets }] }], days: [{ name: "Push", groups: ["Chest"] }] })
        expect(result.ok).toBe(true)
        if (!result.ok) return
        const parsed = result.plan.groups[0].exercises[0].sets!
        expect(Number.isInteger(parsed)).toBe(true)
        expect(parsed).toBeGreaterThanOrEqual(PLAN_LIMITS.sets.min)
        expect(parsed).toBeLessThanOrEqual(PLAN_LIMITS.sets.max)
      }),
      RUNS
    )
  })

  it("rejects too many days or groups, a newer format, and days naming groups it doesn't have", () => {
    const group = (i: number) => ({ name: `G${i}`, exercises: [] })
    const day = (i: number) => ({ name: `D${i}`, groups: ["G0"] })
    const ok = (groups: number, days: number) =>
      parsePlan({ groups: Array.from({ length: groups }, (_, i) => group(i)), days: Array.from({ length: days }, (_, i) => day(i)) }).ok
    expect(ok(PLAN_LIMITS.groups, PLAN_LIMITS.days)).toBe(true)
    expect(ok(PLAN_LIMITS.groups + 1, 1)).toBe(false)
    expect(ok(1, PLAN_LIMITS.days + 1)).toBe(false)
    expect(parsePlan({ version: PLAN_VERSION + 1, groups: [group(0)], days: [day(0)] }).ok).toBe(false)
    expect(parsePlan({ groups: [group(0)], days: [{ name: "D", groups: ["Nope"] }] }).ok).toBe(false)
  })
})

describe("the copy-and-paste prompt", () => {
  /** The routine the prompt closes on, fence and all, as a model would echo it back. */
  const embedded = (prompt: string) => prompt.slice(prompt.lastIndexOf("```json"))

  it("embeds the current routine in a form the parser reads back", () => {
    fc.assert(
      fc.property(planArb, fc.option(fc.constant("Bench Press"), { nil: undefined }), (plan, mainLift) => {
        const result = readPlanText(embedded(buildCopyPrompt(plan, { mainLift })))
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.plan).toEqual(normalised(plan))
      }),
      { numRuns: 60 }
    )
  })

  it("reads the reply when the whole conversation is pasted back, prompt and all", () => {
    const replies: Record<string, (json: string) => string> = {
      fenced: (j) => "Here's your new routine:\n\n```json\n" + j + "\n```\n\nWant any changes?",
      bare: (j) => j,
      "fenced, curly quotes": (j) => "```json\n" + j.replace(/"/g, "“") + "\n```",
    }
    fc.assert(
      fc.property(
        planArb,
        planArb,
        fc.option(fc.constant("Bench Press"), { nil: undefined }),
        fc.constantFrom(...Object.keys(replies)),
        fc.boolean(),
        (current, reply, mainLift, style, pretty) => {
          const conversation = [
            buildCopyPrompt(current, { mainLift }),
            "",
            "Sure! A few questions first: how many days a week do you train?",
            "",
            "4 days, an hour, full gym, muscle, 2 years.",
            "",
            replies[style](JSON.stringify(reply, null, pretty ? 2 : undefined)),
          ].join("\n")
          const result = readPlanText(conversation)
          expect(result.ok).toBe(true)
          if (result.ok) expect(result.plan).toEqual(normalised(reply))
        }
      ),
      { numRuns: 60 }
    )
  })

  it("reads the current routine out of the copy prompt pasted back on its own", () => {
    fc.assert(
      fc.property(planArb, fc.option(fc.constant("Bench Press"), { nil: undefined }), (plan, mainLift) => {
        const result = readPlanText(buildCopyPrompt(plan, { mainLift }))
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.plan).toEqual(normalised(plan))
      }),
      { numRuns: 60 }
    )
  })

  it("shows the model an example that is itself a valid plan", () => {
    const prompt = buildCopyPrompt({ version: PLAN_VERSION, groups: [], days: [] }, {})
    const lines = prompt.split("\n")
    const example = lines[lines.indexOf("The routine is one JSON object in exactly this shape:") + 1]
    expect(parsePlan(JSON.parse(example)).ok).toBe(true)
  })

  it("round-trips the default routine without changing it", () => {
    const config = [...DEFAULT_MUSCLE_GROUPS, DEFAULT_CARDIO_GROUP]
    const exported = exportPlan(config, DEFAULT_TRAINING_DAYS)
    const result = readPlanText(embedded(buildCopyPrompt(exported, { mainLift: "Bench Press" })))
    expect(result.ok).toBe(true)
    if (result.ok) expect(resolvePlan(result.plan, config, DEFAULT_TRAINING_DAYS).changes.unchanged).toBe(true)
  })
})

describe("Dot's questions", () => {
  const answersArb = fc.record(Object.fromEntries(PLAN_QUESTIONS.map((q) => [q.key, fc.constantFrom(...q.options.map((o) => o.value))])) as Record<string, fc.Arbitrary<string>>)

  it("accept every combination of the offered options, with or without a note", () => {
    fc.assert(
      fc.property(answersArb, fc.option(fc.string({ maxLength: PLAN_NOTE_MAX }), { nil: undefined }), (answers, note) => {
        const parsed = parsePlanAnswers({ ...answers, ...(note === undefined ? {} : { note }) })
        expect(parsed).toMatchObject(answers)
        if (note?.trim()) expect(parsed!.note).toBe(note.trim())
      }),
      RUNS
    )
  })

  it("reject an answer that isn't one of the options, a missing one, or a note over the limit", () => {
    fc.assert(
      fc.property(answersArb, fc.constantFrom(...PLAN_QUESTIONS.map((q) => q.key)), fc.anything(), (answers, key, value) => {
        const q = PLAN_QUESTIONS.find((x) => x.key === key)!
        fc.pre(!q.options.some((o) => o.value === value))
        expect(parsePlanAnswers({ ...answers, [key]: value })).toBeNull()
      }),
      RUNS
    )
    const valid = Object.fromEntries(PLAN_QUESTIONS.map((q) => [q.key, q.options[0].value]))
    expect(parsePlanAnswers({ ...valid, note: "x".repeat(PLAN_NOTE_MAX + 1) })).toBeNull()
    expect(parsePlanAnswers(null)).toBeNull()
  })

  it("a repair retry quotes the reply (at most 8000 characters) and every error", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 9000 }), fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 4 }), (reply, errors) => {
        const msgs = buildRepairMessages([{ role: "system", content: "s" }], reply, errors)
        expect(msgs[1]).toEqual({ role: "assistant", content: reply.slice(0, 8000) })
        errors.forEach((e) => expect(msgs[2].content).toContain(`- ${e}`))
      }),
      { numRuns: 50 }
    )
  })
})
