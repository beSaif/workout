import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Session, TrainingBlock } from "@/lib/types"

const kv = vi.hoisted(() => ({
  get: vi.fn(),
  mget: vi.fn(),
  set: vi.fn(),
}))
vi.mock("@vercel/kv", () => ({ kv }))

import {
  copySessionsDoc,
  readSessionsDoc,
  readValidSessionsDoc,
  readValidSessionsDocs,
  writeSessionsDoc,
} from "./db"

const session: Session = {
  id: 1,
  date: "2026-01-02",
  type: "Volume",
  bw: 80,
  sets: [{ id: "s1", kg: 80, reps: 5, rpe: null, e1rm: null, note: "", isWarmup: false }],
  confirmed: true,
  coachNote: "",
}
const block: TrainingBlock = {
  id: 1,
  phase: "accumulation",
  status: "active",
  sessionIds: [1],
  anchorWeight: 80,
  startDate: "2026-01-02",
  endDate: null,
}

/** Stored, but not something the app ever wrote: a session missing most of its fields. */
const malformed = { sessions: [{ id: "x" }], blocks: [] }

beforeEach(() => {
  kv.get.mockReset()
  kv.mget.mockReset()
  kv.set.mockReset()
})

describe("readSessionsDoc (the owner's own document)", () => {
  it("is null when nothing is stored", async () => {
    kv.get.mockResolvedValue(null)
    expect(await readSessionsDoc("A@Example.com")).toBeNull()
    expect(kv.get).toHaveBeenCalledWith("user:a@example.com:sessions")
  })

  it("wraps the legacy bare array as { sessions, blocks: [] }", async () => {
    kv.get.mockResolvedValue([session])
    expect(await readSessionsDoc("a@example.com")).toEqual({
      stored: { sessions: [session], blocks: [] },
      valid: { sessions: [session], blocks: [] },
    })
  })

  it("passes the current shape through", async () => {
    const doc = { sessions: [session], blocks: [block] }
    kv.get.mockResolvedValue(doc)
    expect(await readSessionsDoc("a@example.com")).toEqual({ stored: doc, valid: doc })
  })

  it("keeps a malformed document as stored rather than reading it as missing", async () => {
    // A null here would make the client upload its local copy over the real data.
    kv.get.mockResolvedValue(malformed)
    const read = await readSessionsDoc("a@example.com")
    expect(read).not.toBeNull()
    expect(read?.stored).toEqual(malformed)
    expect(read?.valid).toBeNull()
  })

  it("keeps a malformed legacy array, wrapped", async () => {
    kv.get.mockResolvedValue([{ id: "x" }])
    const read = await readSessionsDoc("a@example.com")
    expect(read?.stored).toEqual({ sessions: [{ id: "x" }], blocks: [] })
    expect(read?.valid).toBeNull()
  })

  it("copies what was read back unchanged, even when malformed", async () => {
    kv.get.mockResolvedValue(malformed)
    const read = await readSessionsDoc("a@example.com")
    await copySessionsDoc("b@example.com", read!)
    expect(kv.set).toHaveBeenCalledWith("user:b@example.com:sessions", malformed)
  })
})

describe("readValidSessionsDoc (someone else's, read-only)", () => {
  it("is empty when nothing is stored", async () => {
    kv.get.mockResolvedValue(null)
    expect(await readValidSessionsDoc("a@example.com")).toEqual({ sessions: [], blocks: [] })
  })

  it("normalises the legacy bare array", async () => {
    kv.get.mockResolvedValue([session])
    expect(await readValidSessionsDoc("a@example.com")).toEqual({ sessions: [session], blocks: [] })
  })

  it("returns the current shape", async () => {
    kv.get.mockResolvedValue({ sessions: [session], blocks: [block] })
    expect(await readValidSessionsDoc("a@example.com")).toEqual({ sessions: [session], blocks: [block] })
  })

  it("reads a malformed document as empty", async () => {
    kv.get.mockResolvedValue(malformed)
    expect(await readValidSessionsDoc("a@example.com")).toEqual({ sessions: [], blocks: [] })
    kv.get.mockResolvedValue("not a document")
    expect(await readValidSessionsDoc("a@example.com")).toEqual({ sessions: [], blocks: [] })
  })
})

describe("readValidSessionsDocs", () => {
  it("reads every user in one mget, normalising each, in order", async () => {
    kv.mget.mockResolvedValue([[session], null, malformed, { sessions: [session], blocks: [block] }])
    const docs = await readValidSessionsDocs(["a@x.com", "b@x.com", "c@x.com", "d@x.com"])
    expect(kv.mget).toHaveBeenCalledTimes(1)
    expect(kv.mget).toHaveBeenCalledWith(
      "user:a@x.com:sessions",
      "user:b@x.com:sessions",
      "user:c@x.com:sessions",
      "user:d@x.com:sessions"
    )
    expect(docs).toEqual([
      { sessions: [session], blocks: [] },
      { sessions: [], blocks: [] },
      { sessions: [], blocks: [] },
      { sessions: [session], blocks: [block] },
    ])
  })

  it("makes no call for no users", async () => {
    expect(await readValidSessionsDocs([])).toEqual([])
    expect(kv.mget).not.toHaveBeenCalled()
  })
})

describe("writeSessionsDoc", () => {
  it("stores the document under the user's key", async () => {
    const doc = { sessions: [session], blocks: [block] }
    await writeSessionsDoc("A@example.com ", doc)
    expect(kv.set).toHaveBeenCalledWith("user:a@example.com:sessions", doc)
  })
})
