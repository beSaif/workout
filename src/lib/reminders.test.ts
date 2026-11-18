import { describe, expect, it } from "vitest"
import fc from "fast-check"
import type { Session, UserProfile, WeightEntry } from "./types"
import { NUDGE_AFTER_DAYS, NUDGE_REPEAT_DAYS, dateKeyInTz, decideReminder, lastSessionDay, type ReminderState } from "./reminders"

const RUNS = { numRuns: 200 }
const HOUR = 3_600_000
const DAY = 24 * HOUR

// Fixed-offset zones give an oracle for "the user's own calendar day" that doesn't go
// through Intl: Etc/GMT-5 is UTC+5 (the sign is POSIX's, inverted).
const offsetArb = fc.integer({ min: -12, max: 14 })
const zoneOf = (offset: number) => (offset === 0 ? "Etc/GMT" : `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`)
const localKey = (t: number, offset: number) => new Date(t + offset * HOUR).toISOString().slice(0, 10)
const keyDays = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / DAY

const T0 = Date.UTC(2026, 10, 2, 6) // a Monday, 06:00 UTC, when the cron runs
const timeArb = fc.integer({ min: T0 - 60 * DAY, max: T0 + 60 * DAY })

const liftProfile: UserProfile = { email: "a@b.c", name: "A", bw: 80, mainLift: "bench", weighInDaily: true, createdAt: "2026-01-01" }

function sessionAt(id: number, iso: string | null, confirmed = true): Session {
  return { id, date: iso, type: "Volume", bw: null, sets: [], confirmed, coachNote: "" }
}

const sessionsArb = fc.array(
  fc.record({ t: timeArb, confirmed: fc.boolean(), dated: fc.boolean() }).map(({ t, confirmed, dated }, ) => ({ t, confirmed, dated })),
  { maxLength: 6 }
)
const toSessions = (xs: { t: number; confirmed: boolean; dated: boolean }[]) =>
  xs.map((x, i) => sessionAt(i + 1, x.dated ? new Date(x.t).toISOString() : null, x.confirmed))

describe("dateKeyInTz", () => {
  it("is the calendar date in the user's zone", () => {
    fc.assert(
      fc.property(timeArb, offsetArb, (t, offset) => {
        expect(dateKeyInTz(new Date(t), zoneOf(offset))).toBe(localKey(t, offset))
      }),
      RUNS
    )
    const lateUtc = new Date("2026-11-18T23:30:00Z")
    expect(dateKeyInTz(lateUtc, "Pacific/Auckland")).toBe("2026-11-19")
    expect(dateKeyInTz(lateUtc, "America/Los_Angeles")).toBe("2026-11-18")
  })

  it("treats a missing or unknown zone as UTC instead of throwing", () => {
    fc.assert(
      fc.property(timeArb, fc.string(), (t, tz) => {
        const key = dateKeyInTz(new Date(t), tz)
        expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(dateKeyInTz(new Date(t), "Not/AZone")).toBe(localKey(t, 0))
        expect(dateKeyInTz(new Date(t), undefined)).toBe(localKey(t, 0))
      }),
      RUNS
    )
  })
})

describe("the time-off nudge", () => {
  const optedOut: UserProfile = { ...liftProfile, weighInDaily: false }

  it("goes out once the last confirmed session is two of the user's own days behind", () => {
    fc.assert(
      fc.property(sessionsArb, timeArb, offsetArb, (raw, now, offset) => {
        const sessions = toSessions(raw)
        const confirmed = raw.filter((x) => x.confirmed && x.dated).map((x) => localKey(x.t, offset)).sort()
        const decision = decideReminder({ profile: optedOut, weights: [], sessions, state: { tz: zoneOf(offset) }, now: new Date(now) })
        const last = confirmed[confirmed.length - 1]
        expect(lastSessionDay(sessions, zoneOf(offset))).toBe(last ?? null)
        const due = last !== undefined && keyDays(last, localKey(now, offset)) >= NUDGE_AFTER_DAYS
        expect(decision?.kind ?? null).toBe(due ? "inactivity" : null)
        if (decision) expect(decision.stateUpdate).toEqual({ lastNudgePush: localKey(now, offset) })
      }),
      RUNS
    )
  })

  it("counts days in the user's timezone, not the server's", () => {
    // 23:30 UTC on the 16th is the 17th in Auckland and the 16th in Los Angeles.
    const sessions = [sessionAt(1, "2026-11-16T23:30:00Z")]
    const cron = new Date("2026-11-18T06:00:00Z") // 18th in UTC, 18th 19:00 Auckland, 17th 22:00 LA
    const kind = (tz?: string) => decideReminder({ profile: optedOut, weights: [], sessions, state: { tz }, now: cron })?.kind ?? null
    expect(kind(undefined)).toBe("inactivity") // 16th → 18th
    expect(kind("UTC")).toBe("inactivity")
    expect(kind("Pacific/Auckland")).toBeNull() // 17th → 18th
    expect(kind("America/Los_Angeles")).toBeNull() // 16th → 17th
  })

  it("then goes quiet for a week at a time until training resumes", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 30 }), offsetArb, fc.integer({ min: 20, max: 40 }), (gap, offset, span) => {
        const tz = zoneOf(offset)
        let state: ReminderState = { tz }
        const sent: number[] = []
        const lastSession = T0 - gap * DAY
        for (let d = 0; d < span; d++) {
          const decision = decideReminder({ profile: optedOut, weights: [], sessions: [sessionAt(1, new Date(lastSession).toISOString())], state, now: new Date(T0 + d * DAY) })
          if (decision) {
            sent.push(d)
            state = { ...state, ...decision.stateUpdate }
          }
        }
        const firstDue = Math.max(0, NUDGE_AFTER_DAYS - keyDays(localKey(lastSession, offset), localKey(T0, offset)))
        expect(sent[0]).toBe(firstDue)
        for (let i = 1; i < sent.length; i++) expect(sent[i] - sent[i - 1]).toBe(NUDGE_REPEAT_DAYS)
        // Logging a session cancels the pending nudge.
        const trained = decideReminder({ profile: optedOut, weights: [], sessions: [sessionAt(2, new Date(T0 + span * DAY - HOUR).toISOString())], state, now: new Date(T0 + span * DAY) })
        expect(trained).toBeNull()
      }),
      { numRuns: 60 }
    )
  })

  it("never fires for someone who has never logged a confirmed session", () => {
    const drafts = [sessionAt(1, "2026-10-01T10:00:00Z", false), sessionAt(2, null)]
    expect(decideReminder({ profile: optedOut, weights: [], sessions: drafts, state: {}, now: new Date(T0) })).toBeNull()
  })
})

describe("the weigh-in reminder", () => {
  it("never goes to someone who hasn't switched check-ins on", () => {
    fc.assert(
      fc.property(fc.constantFrom(undefined, false), (weighInDaily) => {
        const profile = { ...liftProfile, weighInDaily }
        expect(decideReminder({ profile, weights: [], sessions: [], state: {}, now: new Date(T0) })).toBeNull()
        expect(decideReminder({ profile: null, weights: [], sessions: [], state: {}, now: new Date(T0) })).toBeNull()
      })
    )
  })

  it("goes to someone with check-ins on who has never weighed in, and not after a weigh-in today", () => {
    fc.assert(
      fc.property(offsetArb, (offset) => {
        const state = { tz: zoneOf(offset) }
        const now = new Date(T0)
        expect(decideReminder({ profile: liftProfile, weights: [], sessions: [], state, now })?.kind).toBe("weigh-in")
        const today: WeightEntry = { date: localKey(T0, offset), kg: 80, loggedAt: now.toISOString() }
        expect(decideReminder({ profile: liftProfile, weights: [today], sessions: [], state, now })).toBeNull()
      }),
      RUNS
    )
  })
})

describe("one push a day", () => {
  /** Run the daily job `days` times on stored data that doesn't change, as the cron route does. */
  function runDays(sessions: Session[], weights: WeightEntry[], tz: string, days: number, rerun: boolean) {
    let state: ReminderState = { tz }
    const log: { day: number; kinds: string[] }[] = []
    for (let d = 0; d < days; d++) {
      const kinds: string[] = []
      // A rerun half an hour later: still the same calendar day in every zone at 06:00 UTC.
      for (const hour of rerun ? [0, 0.5] : [0]) {
        const decision = decideReminder({ profile: liftProfile, weights, sessions, state, now: new Date(T0 + d * DAY + hour * HOUR) })
        if (!decision) continue
        kinds.push(decision.kind)
        state = { ...state, ...decision.stateUpdate }
      }
      log.push({ day: d, kinds })
    }
    return log
  }

  it("the time-off nudge takes the day; the weigh-in goes out the day after", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 20 }), fc.integer({ min: -3, max: 3 }), (gap, offset) => {
        const sessions = [sessionAt(1, new Date(T0 - gap * DAY).toISOString())]
        const log = runDays(sessions, [], zoneOf(offset), 3, false)
        expect(log.map((l) => l.kinds)).toEqual([["inactivity"], ["weigh-in"], []])
      }),
      RUNS
    )
  })

  it("over weeks of no training and no weigh-ins, each reminder keeps its own weekly cadence", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20 }), offsetArb, fc.option(fc.integer({ min: 0, max: 20 }), { nil: null }), (gap, offset, weighedAgo) => {
        const tz = zoneOf(offset)
        const sessions = [sessionAt(1, new Date(T0 - gap * DAY).toISOString())]
        const weights = weighedAgo === null ? [] : [{ date: localKey(T0 - weighedAgo * DAY, offset), kg: 80, loggedAt: "" }]
        const log = runDays(sessions, weights, tz, 35, false)
        for (const kind of ["inactivity", "weigh-in"]) {
          const days = log.filter((l) => l.kinds.includes(kind)).map((l) => l.day)
          for (let i = 1; i < days.length; i++) expect(days[i] - days[i - 1]).toBeGreaterThanOrEqual(7)
        }
        log.forEach((l) => expect(l.kinds.length).toBeLessThanOrEqual(1))
      }),
      { numRuns: 60 }
    )
  })

  it("a second run on the same day after a weigh-in reminder sends nothing, and never repeats a nudge", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20 }), offsetArb, (gap, offset) => {
        const sessions = [sessionAt(1, new Date(T0 - gap * DAY).toISOString())]
        const log = runDays(sessions, [], zoneOf(offset), 21, true)
        for (const { kinds } of log) {
          if (kinds[0] === "weigh-in") expect(kinds).toEqual(["weigh-in"])
          expect(kinds.filter((k) => k === "inactivity").length).toBeLessThanOrEqual(1)
        }
      }),
      { numRuns: 60 }
    )
  })
})
