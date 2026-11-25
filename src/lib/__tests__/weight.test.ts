import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { addDays, daysBetween, delta, removeEntry, rollingAverage, upsertEntry } from "@/lib/weight"
import type { WeightEntry } from "@/lib/types"

const entry = (date: string, kg: number, loggedAt = `${date}T08:00:00.000Z`): WeightEntry => ({
  date,
  kg,
  loggedAt,
})

describe("addDays", () => {
  it("shifts forward and back across month and year boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01")
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28")
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01")
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31")
  })

  it("handles leap days", () => {
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29")
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29")
  })

  it("returns the same key for 0 and zero-pads month and day", () => {
    expect(addDays("2026-09-09", 0)).toBe("2026-09-09")
    expect(addDays("2026-09-09", 1)).toBe("2026-09-10")
  })

  it("does not skip or repeat a day across DST changes (TZ is Europe/Zurich in vitest)", () => {
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29")
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30")
    expect(addDays("2026-10-24", 1)).toBe("2026-10-25")
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26")
  })
})

describe("daysBetween", () => {
  it("counts whole days, negative when `to` is earlier", () => {
    expect(daysBetween("2026-01-01", "2026-01-08")).toBe(7)
    expect(daysBetween("2026-01-08", "2026-01-01")).toBe(-7)
    expect(daysBetween("2026-01-01", "2026-01-01")).toBe(0)
  })

  it("crosses year ends and leap days", () => {
    expect(daysBetween("2025-12-31", "2026-01-01")).toBe(1)
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2)
  })

  it("is exact across DST changes", () => {
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2)
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2)
  })

  it("agrees with addDays", () => {
    expect(daysBetween("2026-02-10", addDays("2026-02-10", 45))).toBe(45)
  })
})

describe("upsertEntry", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-10T12:00:00.000Z"))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("inserts a new date and returns the entries sorted by date", () => {
    const entries = [entry("2026-01-03", 81), entry("2026-01-01", 80)]
    expect(upsertEntry(entries, "2026-01-02", 80.5)).toEqual([
      entry("2026-01-01", 80),
      { date: "2026-01-02", kg: 80.5, loggedAt: "2026-01-10T12:00:00.000Z" },
      entry("2026-01-03", 81),
    ])
  })

  it("replaces the existing entry for the same date (one per day)", () => {
    const entries = [entry("2026-01-01", 80), entry("2026-01-02", 79)]
    expect(upsertEntry(entries, "2026-01-02", 79.4)).toEqual([
      entry("2026-01-01", 80),
      { date: "2026-01-02", kg: 79.4, loggedAt: "2026-01-10T12:00:00.000Z" },
    ])
  })

  it("does not mutate the input", () => {
    const entries = [entry("2026-01-02", 79), entry("2026-01-01", 80)]
    const before = structuredClone(entries)
    upsertEntry(entries, "2026-01-03", 78)
    expect(entries).toEqual(before)
  })
})

describe("removeEntry", () => {
  it("removes the entry for the date and returns a sorted copy", () => {
    const entries = [entry("2026-01-03", 81), entry("2026-01-02", 80.5), entry("2026-01-01", 80)]
    expect(removeEntry(entries, "2026-01-02")).toEqual([entry("2026-01-01", 80), entry("2026-01-03", 81)])
  })

  it("returns a sorted copy unchanged when the date is absent", () => {
    const entries = [entry("2026-01-02", 81), entry("2026-01-01", 80)]
    const result = removeEntry(entries, "2026-01-05")
    expect(result).toEqual([entry("2026-01-01", 80), entry("2026-01-02", 81)])
    expect(result).not.toBe(entries)
  })
})

describe("delta", () => {
  const entries = [entry("2026-01-08", 79), entry("2026-01-01", 80), entry("2026-01-05", 79.5)]

  it("compares the newest entry with the newest one at least `days` old", () => {
    expect(delta(entries, 7)).toBe(-1)
    expect(delta(entries, 3)).toBe(-0.5)
  })

  it("searches by date, not by index, over a gappy log", () => {
    // 2 days back from 01-08 is 01-06; the newest entry on or before that is 01-05.
    expect(delta(entries, 2)).toBe(-0.5)
  })

  it("returns null when nothing is old enough, or the log is empty", () => {
    expect(delta(entries, 10)).toBeNull()
    expect(delta([], 7)).toBeNull()
  })

  it("compares the newest entry with itself for 0 days", () => {
    expect(delta(entries, 0)).toBe(0)
  })

  it("rounds to one decimal place", () => {
    expect(delta([entry("2026-01-01", 80), entry("2026-01-08", 79.3)], 7)).toBe(-0.7)
  })
})

describe("rollingAverage", () => {
  it("averages over the trailing calendar window (default 7 days), not entry count", () => {
    const entries = [entry("2026-01-08", 82), entry("2026-01-01", 80), entry("2026-01-03", 81)]
    expect(rollingAverage(entries)).toEqual([
      { date: "2026-01-01", kg: 80 },
      { date: "2026-01-03", kg: 80.5 },
      // window 01-02..01-08: 81 and 82; 01-01 falls outside
      { date: "2026-01-08", kg: 81.5 },
    ])
  })

  it("supports a custom window", () => {
    const entries = [entry("2026-01-01", 80), entry("2026-01-02", 81), entry("2026-01-03", 85)]
    expect(rollingAverage(entries, 1)).toEqual([
      { date: "2026-01-01", kg: 80 },
      { date: "2026-01-02", kg: 81 },
      { date: "2026-01-03", kg: 85 },
    ])
    expect(rollingAverage(entries, 2)).toEqual([
      { date: "2026-01-01", kg: 80 },
      { date: "2026-01-02", kg: 80.5 },
      { date: "2026-01-03", kg: 83 },
    ])
  })

  it("rounds to one decimal place", () => {
    const entries = [entry("2026-01-01", 80), entry("2026-01-02", 80), entry("2026-01-03", 80.1)]
    // (80 + 80 + 80.1) / 3 = 80.033…
    expect(rollingAverage(entries).at(-1)).toEqual({ date: "2026-01-03", kg: 80 })
  })

  it("returns an empty series for no entries", () => {
    expect(rollingAverage([])).toEqual([])
  })
})
