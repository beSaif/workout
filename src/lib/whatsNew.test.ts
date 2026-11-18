import { describe, expect, it } from "vitest"
import fc from "fast-check"
import { WHATS_NEW, WHATS_NEW_VERSION, pendingWhatsNew } from "./whatsNew"

describe("WHATS_NEW", () => {
  it("is newest first, each version the previous + 1, counting up from 1", () => {
    const versions = WHATS_NEW.map((r) => r.version)
    expect(versions.length).toBeGreaterThan(0)
    expect(versions[versions.length - 1]).toBe(1)
    for (let i = 1; i < versions.length; i++) expect(versions[i - 1]).toBe(versions[i] + 1)
    expect(WHATS_NEW_VERSION).toBe(versions[0])
  })

  it("has something to say in every release", () => {
    for (const release of WHATS_NEW) {
      expect(release.items.length).toBeGreaterThan(0)
      for (const item of release.items) {
        expect(item.title.trim()).not.toBe("")
        expect(item.body.trim()).not.toBe("")
      }
    }
  })

  it("shows a user every release newer than the one they last saw, newest first", () => {
    fc.assert(
      fc.property(fc.integer({ min: -2, max: WHATS_NEW_VERSION + 2 }), (seen) => {
        const pending = pendingWhatsNew(seen).map((r) => r.version)
        const expected = Array.from({ length: Math.max(0, WHATS_NEW_VERSION - Math.max(0, seen)) }, (_, i) => WHATS_NEW_VERSION - i)
        expect(pending).toEqual(expected)
      })
    )
  })
})
