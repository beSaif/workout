import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { ExerciseGroup, groupId, reorderGroups, withMainFirst } from "./exerciseOrder"

const extra = (exercise: string): ExerciseGroup => ({ kind: "extra", muscle: "Back", exercise })
const MAIN: ExerciseGroup = { kind: "main" }

/** A main-lift session's rows: the main lift somewhere, then distinct accessories. */
const orderArb = fc
  .uniqueArray(fc.string({ minLength: 1, maxLength: 6 }), { minLength: 1, maxLength: 8 })
  .chain((names) =>
    fc.integer({ min: 0, max: names.length }).map((at) => {
      const rows = names.map(extra)
      rows.splice(at, 0, MAIN)
      return rows
    })
  )

describe("withMainFirst", () => {
  it("moves the main lift to the top and keeps the accessories' order", () => {
    expect(withMainFirst([extra("a"), extra("b"), MAIN, extra("c")])).toEqual([MAIN, extra("a"), extra("b"), extra("c")])
  })

  it("leaves a Balanced session (no main lift) alone", () => {
    const order = [extra("a"), extra("b")]
    expect(withMainFirst(order)).toBe(order)
  })
})

describe("reorderGroups", () => {
  it("moves accessories among themselves", () => {
    const order = [MAIN, extra("a"), extra("b"), extra("c")]
    expect(reorderGroups(order, groupId(extra("c")), groupId(extra("a")))).toEqual([MAIN, extra("c"), extra("a"), extra("b")])
  })

  it("never moves the main lift out of first place, whatever is dragged where", () => {
    fc.assert(
      fc.property(orderArb, fc.nat(), fc.nat(), (raw, a, b) => {
        const order = withMainFirst(raw)
        const ids = order.map(groupId)
        const next = reorderGroups(order, ids[a % ids.length], ids[b % ids.length])
        expect(next[0]).toEqual(MAIN)
        expect(next.map(groupId).sort()).toEqual([...ids].sort())
      })
    )
  })
})
