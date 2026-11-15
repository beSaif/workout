"use client"

import { useEffect, useState, type CSSProperties } from "react"

export interface ProgressDash {
  /** Stable identity — this is what the enter/exit animation tracks. */
  key: string
  /** The exercise the set belongs to; a change of group opens a wider gap. */
  groupKey: string
  done: boolean
  /** Screen-reader label, e.g. "Bench Press · set 2". */
  label: string
}

interface SessionProgressDashesProps {
  dashes: ProgressDash[]
  /** Index into `dashes` of the set on screen. */
  currentIndex: number
  onSelect: (index: number) => void
}

type Phase = "in" | "present" | "out"

interface RenderedDash extends ProgressDash {
  phase: Phase
  /** Index into `dashes`, or null once the dash is on its way out. */
  index: number | null
}

/** Gap either side of a dash, and the wider one that separates two exercises. */
const GAP = 2
const GROUP_GAP = 12

/** The set on screen gets a slightly longer dash so it reads as a position, not a dot. */
const CURRENT_GROW = 1.5

/** Safety net in case animationend never lands (background tab, cancelled animation). */
const EXIT_FALLBACK_MS = 500

/**
 * Splice the incoming dashes over what is currently on screen, keeping a dash
 * that has gone away in its old slot so it can animate out from there.
 */
function merge(prev: RenderedDash[], next: ProgressDash[]): RenderedDash[] {
  const nextKeys = new Set(next.map((d) => d.key))
  const prevByKey = new Map(prev.map((r) => [r.key, r]))
  const out: RenderedDash[] = []
  let pi = 0

  next.forEach((dash, index) => {
    // Anything dropped ahead of this dash holds its slot until it has faded.
    while (pi < prev.length && prev[pi].key !== dash.key) {
      const stale = prev[pi]
      if (!nextKeys.has(stale.key)) out.push({ ...stale, index: null, phase: "out" })
      pi++
    }
    if (pi < prev.length && prev[pi].key === dash.key) pi++

    const existing = prevByKey.get(dash.key)
    const survives = existing != null && existing.phase !== "out"
    out.push({ ...dash, index, phase: survives ? existing.phase : "in" })
  })

  for (; pi < prev.length; pi++) {
    const stale = prev[pi]
    if (!nextKeys.has(stale.key)) out.push({ ...stale, index: null, phase: "out" })
  }

  return out
}

/**
 * The session's sets as a row of dashes — one per set, clustered by exercise.
 * Tap a dash to jump to that set.
 */
export default function SessionProgressDashes({
  dashes,
  currentIndex,
  onSelect,
}: SessionProgressDashesProps) {
  const [rendered, setRendered] = useState<RenderedDash[]>(() =>
    dashes.map((dash, index) => ({ ...dash, index, phase: "present" as const }))
  )

  // The array identity changes on every parent render, so the merge keys off a
  // signature of what actually matters. Adjusting state during render — rather
  // than in an effect — keeps a new dash from flashing at full width first.
  const signature = dashes.map((d) => `${d.key}~${d.groupKey}~${d.done ? 1 : 0}`).join("|")
  const [mergedSignature, setMergedSignature] = useState(signature)
  if (signature !== mergedSignature) {
    setMergedSignature(signature)
    setRendered((prev) => merge(prev, dashes))
  }

  // Drop faded-out dashes even if their animationend never arrives.
  const hasExiting = rendered.some((r) => r.phase === "out")
  useEffect(() => {
    if (!hasExiting) return
    const t = setTimeout(
      () => setRendered((prev) => prev.filter((r) => r.phase !== "out")),
      EXIT_FALLBACK_MS
    )
    return () => clearTimeout(t)
  }, [hasExiting])

  /**
   * One tab stop for the whole row: the set on screen. Arrows walk it, the way a
   * slider or a set of radios does, so a session never costs twenty tab presses.
   */
  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0
    if (delta === 0) return
    e.preventDefault()
    const next = Math.max(0, Math.min(dashes.length - 1, index + delta))
    if (next === index) return
    onSelect(next)
    const row = e.currentTarget.parentElement
    requestAnimationFrame(() => {
      row?.querySelector<HTMLButtonElement>(`[data-dash-index="${next}"]`)?.focus()
    })
  }

  function handleAnimationEnd(key: string, phase: Phase) {
    if (phase === "out") {
      setRendered((prev) => prev.filter((r) => r.key !== key || r.phase !== "out"))
      return
    }
    if (phase === "in") {
      setRendered((prev) =>
        prev.map((r) => (r.key === key && r.phase === "in" ? { ...r, phase: "present" } : r))
      )
    }
  }

  if (rendered.length === 0) return null

  return (
    // Dot may stand on this row like on any card, but it does not follow the sets.
    <div
      className="flex items-center h-5 w-full"
      role="group"
      aria-label="Session progress"
      data-ledge
      data-ledge-inset="8"
    >
      {rendered.map((dash, i) => {
        const startsGroup = i > 0 && dash.groupKey !== rendered[i - 1].groupKey
        const isCurrent = dash.index !== null && dash.index === currentIndex
        const interactive = dash.phase !== "out" && dash.index !== null

        const style = {
          "--dash-ml": `${startsGroup ? GROUP_GAP : GAP}px`,
          "--dash-mr": `${GAP}px`,
          marginLeft: "var(--dash-ml)",
          marginRight: "var(--dash-mr)",
          flexGrow: isCurrent ? CURRENT_GROW : 1,
          flexBasis: 0,
          minWidth: 0,
        } as CSSProperties

        return (
          <button
            key={dash.key}
            type="button"
            aria-label={dash.label}
            aria-current={isCurrent ? "step" : undefined}
            data-dash-index={dash.index ?? undefined}
            tabIndex={isCurrent ? 0 : -1}
            disabled={!interactive}
            style={style}
            className={`h-5 flex items-center touch-manipulation rounded-md outline-none
                        transition-[flex-grow] duration-300 ease-out
                        focus-visible:ring-2 focus-visible:ring-brand-line/30 ${
              dash.phase === "in"
                ? "animate-dash-in"
                : dash.phase === "out"
                  ? "animate-dash-out pointer-events-none"
                  : ""
            }`}
            onAnimationEnd={() => handleAnimationEnd(dash.key, dash.phase)}
            onKeyDown={(e) => dash.index !== null && handleKeyDown(e, dash.index)}
            onClick={() => {
              if (dash.index === null) return
              navigator.vibrate?.([6])
              onSelect(dash.index)
            }}
          >
            <span
              className={`block w-full rounded-full transition-[height,background-color,box-shadow] duration-300 ease-out ${
                isCurrent
                  ? "h-[5px] bg-accent shadow-[0_0_0_3px_rgba(30,58,95,0.10)]"
                  : dash.done
                    ? "h-[3px] bg-accent"
                    : "h-[3px] bg-surface-4"
              }`}
            />
          </button>
        )
      })}
    </div>
  )
}
