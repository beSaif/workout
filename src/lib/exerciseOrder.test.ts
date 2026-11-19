import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { ExerciseGroup, groupId, reorderGroups } from "./exerciseOrder"

const extra = (exercise: string): ExerciseGroup => ({ kind: "extra", muscle: "Back", exercise })
const MAIN: ExerciseGroup = { kind: "main" }

/** A main-lift session's rows: the main lift somewhere among distinct accessories. */
const orderArb = fc
  .uniqueArray(fc.string({ minLength: 1, maxLength: 6 }), { minLength: 1, maxLength: 8 })
  .chain((names) =>
    fc.integer({ min: 0, max: names.length }).map((at) => {
      const rows = names.map(extra)
      rows.splice(at, 0, MAIN)
      return rows
    })
  )

describe("reorderGroups", () => {
  it("moves the main lift like any other row", () => {
    const order = [MAIN, extra("a"), extra("b")]
    expect(reorderGroups(order, "main", groupId(extra("b")))).toEqual([extra("a"), extra("b"), MAIN])
    expect(reorderGroups([extra("a"), MAIN], groupId(extra("a")), "main")).toEqual([MAIN, extra("a")])
  })

  it("puts the dragged row where the target was and keeps everything else in order", () => {
    fc.assert(
      fc.property(orderArb, fc.nat(), fc.nat(), (order, a, b) => {
        const ids = order.map(groupId)
        const [from, to] = [a % ids.length, b % ids.length]
        const next = reorderGroups(order, ids[from], ids[to]).map(groupId)
        expect(next[to]).toBe(ids[from])
        expect(next.filter((id) => id !== ids[from])).toEqual(ids.filter((id) => id !== ids[from]))
      })
    )
  })

  it("ignores a drag onto a row that isn't there", () => {
    const order = [MAIN, extra("a")]
    expect(reorderGroups(order, "main", "nope")).toBe(order)
  })
})
