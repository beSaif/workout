import { useCallback, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from "react"

/**
 * Reading localStorage from a component, without a hydration mismatch.
 *
 * The server has no localStorage, so a value read during render would make the server
 * HTML and the client's first render disagree. `useSyncExternalStore` solves that: the
 * server and the hydration pass see `undefined`, and React re-renders with the stored
 * value straight after. A component that mounts later (a client-side navigation) gets
 * the stored value on its very first render, so a cached page paints at once.
 *
 * The non-React part — sources, change notification — is exported for tests.
 */

/** A value derived from some localStorage keys. Create once, at module level. */
export interface LocalSource<T> {
  /** The current value; the same reference for as long as the keys' raw strings are unchanged. */
  read(): T
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    // Private mode, blocked storage, or no localStorage at all.
    return null
  }
}

/**
 * A source over `keys`, computed by `load` (normally a `load*Local` helper from
 * storage.ts). `useSyncExternalStore` needs an unchanged value to come back as the
 * same reference, or it re-renders forever; `load` builds a new object each call, so
 * its result is kept until one of the keys' raw strings changes.
 */
export function localSource<T>(keys: readonly string[], load: () => T): LocalSource<T> {
  let lastRaws: (string | null)[] | null = null
  let lastValue: T
  return {
    read() {
      const raws = keys.map(readRaw)
      if (lastRaws && raws.every((raw, i) => raw === lastRaws![i])) return lastValue
      lastValue = load()
      lastRaws = raws
      return lastValue
    },
  }
}

const listeners = new Set<() => void>()
let notifyQueued = false

function notifyAll(): void {
  for (const listener of [...listeners]) listener()
}

function onStorageEvent(): void {
  notifyAll()
}

/**
 * Tell subscribers localStorage changed. The browser's `storage` event only fires in
 * other tabs, so every write in this tab has to call this.
 *
 * Deferred to a microtask: a burst of writes (sessions then blocks) re-renders once,
 * and a write made inside a setState updater does not re-render another component
 * mid-render.
 */
export function notifyLocalChange(): void {
  if (notifyQueued) return
  notifyQueued = true
  queueMicrotask(() => {
    notifyQueued = false
    notifyAll()
  })
}

/** Subscribe to localStorage changes from this tab and from others. */
export function subscribeLocal(listener: () => void): () => void {
  if (listeners.size === 0 && typeof window !== "undefined") {
    window.addEventListener("storage", onStorageEvent)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", onStorageEvent)
    }
  }
}

function serverSnapshot(): undefined {
  return undefined
}

/**
 * The source's current value, kept up to date. `undefined` on the server and during
 * hydration, when localStorage cannot be read yet.
 */
export function useLocalValue<T>(source: LocalSource<T>): T | undefined {
  return useSyncExternalStore<T | undefined>(subscribeLocal, source.read, serverSnapshot)
}

function noSubscribe(): () => void {
  return () => {}
}

/** False on the server and during hydration, true from then on. */
export function useHydrated(): boolean {
  return useSyncExternalStore(noSubscribe, () => true, () => false)
}

/**
 * State that starts from the cached copy of something the page then refreshes from
 * the network: the replacement for seeding useState from localStorage in an effect.
 *
 * Until it is first set it follows the cache (`undefined` before hydration); once set
 * — by the network reply or an edit — it holds its own value, like useState.
 */
export function useCachedState<T>(source: LocalSource<T>): [T | undefined, Dispatch<SetStateAction<T>>] {
  const cached = useLocalValue(source)
  // Boxed so that a `null` the page sets still counts as set.
  const [own, setOwn] = useState<{ value: T } | null>(null)
  const set = useCallback<Dispatch<SetStateAction<T>>>(
    (action) =>
      setOwn((prev) => ({
        value:
          typeof action === "function"
            ? (action as (prev: T) => T)(prev ? prev.value : source.read())
            : action,
      })),
    [source]
  )
  return [own ? own.value : cached, set]
}
