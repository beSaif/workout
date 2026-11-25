import { describe, expect, it } from "vitest"
import { isMuscleGroupConfigArray, isTrainingDayArray, parseSessionsPayload } from "@/lib/validate"

const validSession = (id = 1) => ({
  id,
  date: "2026-01-01T10:00:00.000Z",
  type: "Volume",
  bw: null,
  sets: [{ id: "S1", kg: 100, reps: 5, rpe: null, e1rm: 112.5, note: "", isWarmup: false }],
  confirmed: true,
  coachNote: "",
})

const validBlock = (id = 1) => ({
  id,
  phase: "accumulation",
  status: "active",
  anchorWeight: 120,
  sessionIds: [1, 2],
})

describe("parseSessionsPayload", () => {
  it("accepts the legacy bare session array with empty blocks", () => {
    const body = [validSession(1), validSession(2)]
    expect(parseSessionsPayload(body)).toEqual({ sessions: body, blocks: [] })
  })

  it("accepts { sessions, blocks }", () => {
    const body = { sessions: [validSession()], blocks: [validBlock()] }
    expect(parseSessionsPayload(body)).toEqual(body)
  })

  it("defaults blocks to [] when omitted", () => {
    const body = { sessions: [validSession()] }
    expect(parseSessionsPayload(body)).toEqual({ sessions: body.sessions, blocks: [] })
  })

  it("passes well-formed documents through as sent (same references, extra fields kept)", () => {
    const session = { ...validSession(), skippedMainLift: true, futureField: "kept" }
    const body = { sessions: [session], blocks: [] }
    const parsed = parseSessionsPayload(body)
    expect(parsed?.sessions).toBe(body.sessions)
    expect(parsed?.sessions[0]).toBe(session)
  })

  it("accepts empty arrays and a null session date", () => {
    expect(parseSessionsPayload([])).toEqual({ sessions: [], blocks: [] })
    expect(parseSessionsPayload({ sessions: [{ ...validSession(), date: null }] })).not.toBeNull()
  })

  it("rejects non-array, non-object bodies", () => {
    for (const body of [null, undefined, "sessions", 42, true]) {
      expect(parseSessionsPayload(body)).toBeNull()
    }
  })

  it("rejects an object without a sessions array", () => {
    expect(parseSessionsPayload({})).toBeNull()
    expect(parseSessionsPayload({ sessions: "nope" })).toBeNull()
    expect(parseSessionsPayload({ sessions: [validSession()], blocks: {} })).toBeNull()
  })

  it.each([
    ["non-numeric id", { id: "1" }],
    ["missing date", { date: undefined }],
    ["numeric date", { date: 20260101 }],
    ["non-string type", { type: 1 }],
    ["non-boolean confirmed", { confirmed: "yes" }],
    ["sets not an array", { sets: {} }],
    ["a set without reps", { sets: [{ kg: 100 }] }],
    ["a set with string kg", { sets: [{ kg: "100", reps: 5 }] }],
    ["a null set", { sets: [null] }],
  ])("rejects a session with %s", (_label, patch) => {
    const bad = { ...validSession(), ...patch }
    expect(parseSessionsPayload([bad])).toBeNull()
    expect(parseSessionsPayload({ sessions: [validSession(), bad] })).toBeNull()
  })

  it.each([
    ["non-numeric id", { id: "1" }],
    ["non-string phase", { phase: 3 }],
    ["non-string status", { status: null }],
    ["non-numeric anchorWeight", { anchorWeight: "120" }],
    ["sessionIds not an array", { sessionIds: 1 }],
    ["non-numeric sessionIds", { sessionIds: [1, "2"] }],
  ])("rejects a block with %s", (_label, patch) => {
    expect(parseSessionsPayload({ sessions: [], blocks: [{ ...validBlock(), ...patch }] })).toBeNull()
  })

  it("rejects arrays over the 5000-item ceiling", () => {
    const atLimit = Array.from({ length: 5000 }, (_, i) => validSession(i))
    expect(parseSessionsPayload(atLimit)).not.toBeNull()
    expect(parseSessionsPayload([...atLimit, validSession(5000)])).toBeNull()
    expect(parseSessionsPayload({ sessions: [...atLimit, validSession(5000)] })).toBeNull()
  })
})

describe("isMuscleGroupConfigArray", () => {
  it("accepts well-formed groups and an empty array", () => {
    expect(isMuscleGroupConfigArray([])).toBe(true)
    expect(isMuscleGroupConfigArray([{ id: "chest", name: "Chest", exercises: [] }])).toBe(true)
  })

  it("rejects malformed bodies", () => {
    expect(isMuscleGroupConfigArray(null)).toBe(false)
    expect(isMuscleGroupConfigArray({ id: "chest", name: "Chest", exercises: [] })).toBe(false)
    expect(isMuscleGroupConfigArray([{ id: "chest", name: "Chest" }])).toBe(false)
    expect(isMuscleGroupConfigArray([{ id: 1, name: "Chest", exercises: [] }])).toBe(false)
    expect(isMuscleGroupConfigArray([[]])).toBe(false)
  })

  it("rejects arrays over the 5000-item ceiling", () => {
    const groups = Array.from({ length: 5001 }, (_, i) => ({ id: `g${i}`, name: "G", exercises: [] }))
    expect(isMuscleGroupConfigArray(groups)).toBe(false)
  })
})

describe("isTrainingDayArray", () => {
  it("accepts well-formed days and an empty array", () => {
    expect(isTrainingDayArray([])).toBe(true)
    expect(isTrainingDayArray([{ id: "push", name: "Push", muscleGroupIds: ["chest", "shoulders"] }])).toBe(true)
  })

  it("rejects malformed bodies", () => {
    expect(isTrainingDayArray(undefined)).toBe(false)
    expect(isTrainingDayArray([{ id: "push", name: "Push" }])).toBe(false)
    expect(isTrainingDayArray([{ id: "push", name: "Push", muscleGroupIds: ["chest", 2] }])).toBe(false)
    expect(isTrainingDayArray([{ id: "push", name: 5, muscleGroupIds: [] }])).toBe(false)
  })
})
