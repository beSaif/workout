import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { localSource, notifyLocalChange, subscribeLocal } from "./useLocalValue"

function fakeStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  }
}

let store: ReturnType<typeof fakeStorage>
let win: EventTarget

beforeEach(() => {
  store = fakeStorage()
  win = new EventTarget()
  vi.stubGlobal("localStorage", store)
  vi.stubGlobal("window", win)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve))

describe("localSource", () => {
  it("returns the same reference while the raw string is unchanged", () => {
    const load = vi.fn(() => JSON.parse(store.getItem("k") ?? "[]") as number[])
    const source = localSource(["k"], load)
    store.setItem("k", "[1,2]")
    const first = source.read()
    expect(first).toEqual([1, 2])
    expect(source.read()).toBe(first)
    // Rewriting the same content keeps the reference too: only the raw string counts.
    store.setItem("k", "[1,2]")
    expect(source.read()).toBe(first)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it("reloads when the raw string changes, including removal", () => {
    const source = localSource(["k"], () => store.getItem("k"))
    expect(source.read()).toBeNull()
    store.setItem("k", "a")
    expect(source.read()).toBe("a")
    store.removeItem("k")
    expect(source.read()).toBeNull()
  })

  it("watches every key it depends on", () => {
    const load = vi.fn(() => `${store.getItem("a")}|${store.getItem("b")}`)
    const source = localSource(["a", "b"], load)
    const first = source.read()
    store.setItem("b", "2")
    expect(source.read()).toBe("null|2")
    expect(source.read()).not.toBe(first)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it("reads as missing when localStorage throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError")
      },
    })
    const source = localSource(["k"], () => "fallback")
    expect(source.read()).toBe("fallback")
  })
})

describe("change notification", () => {
  it("batches same-tab writes into one notification after the current task", async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeLocal(listener)
    notifyLocalChange()
    notifyLocalChange()
    expect(listener).not.toHaveBeenCalled()
    await flush()
    expect(listener).toHaveBeenCalledTimes(1)
    notifyLocalChange()
    await flush()
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it("passes on storage events from other tabs", () => {
    const listener = vi.fn()
    const unsubscribe = subscribeLocal(listener)
    win.dispatchEvent(new Event("storage"))
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it("stops listening once the last subscriber leaves", async () => {
    const add = vi.spyOn(win, "addEventListener")
    const remove = vi.spyOn(win, "removeEventListener")
    const a = vi.fn()
    const b = vi.fn()
    const offA = subscribeLocal(a)
    const offB = subscribeLocal(b)
    expect(add).toHaveBeenCalledTimes(1)
    offA()
    expect(remove).not.toHaveBeenCalled()
    notifyLocalChange()
    await flush()
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledTimes(1)
    offB()
    expect(remove).toHaveBeenCalledTimes(1)
    win.dispatchEvent(new Event("storage"))
    expect(b).toHaveBeenCalledTimes(1)
  })

  it("a subscriber sees the new value once notified", async () => {
    const source = localSource(["k"], () => store.getItem("k"))
    const seen: (string | null)[] = []
    const unsubscribe = subscribeLocal(() => seen.push(source.read()))
    store.setItem("k", "x")
    notifyLocalChange()
    await flush()
    expect(seen).toEqual(["x"])
    unsubscribe()
  })
})
