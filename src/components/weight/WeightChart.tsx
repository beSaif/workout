"use client"

import { WeightEntry } from "@/lib/types"
import { daysBetween, formatDay, rollingAverage } from "@/lib/weight"

const VB_W = 100
const VB_H = 42
/** The shortest break that can read as "stopped weighing in" and split the line. */
const MIN_GAP_DAYS = 4
/** Few enough readings that each one is worth a dot of its own. */
const DOT_LIMIT = 40

/**
 * How long a break has to be before the line splits, judged against this person's own
 * rhythm: a few missed check-ins in a row. Check-ins are asked weekly, so a fixed
 * four-day rule broke the line between every pair of readings and drew nothing.
 */
function gapDays(entries: WeightEntry[]): number {
  const gaps = entries.slice(1).map((e, i) => daysBetween(entries[i].date, e.date)).sort((a, b) => a - b)
  const median = gaps[Math.floor(gaps.length / 2)] ?? 1
  return Math.max(MIN_GAP_DAYS, median * 2.5)
}

interface Props {
  /** Entries in the selected range, oldest first. */
  entries: WeightEntry[]
  goalBw?: number
}

interface Pt {
  x: number
  y: number
  gapBefore: boolean
}

/**
 * Weight over time: raw readings faint, the 7-day average emphasised, the goal as a
 * dashed rule. Hand-built SVG because the app carries no charting library and the
 * whole visual language here is inline SVG.
 */
export default function WeightChart({ entries, goalBw }: Props) {
  if (entries.length < 2) {
    return (
      <div className="h-[140px] flex items-center justify-center rounded-xl bg-surface-1 border border-line-soft">
        <p className="text-sm text-ink-6">
          {entries.length === 0 ? "nothing logged yet" : "one reading — log another to see a trend"}
        </p>
      </div>
    )
  }

  const avg = rollingAverage(entries)
  const first = entries[0].date
  const span = daysBetween(first, entries[entries.length - 1].date) || 1

  const kgs = entries.map((e) => e.kg)
  let min = Math.min(...kgs)
  let max = Math.max(...kgs)
  // Keep the goal line inside the frame, otherwise it silently clips off the top.
  if (goalBw != null) {
    min = Math.min(min, goalBw)
    max = Math.max(max, goalBw)
  }
  const pad = (max - min) * 0.12 || 0.5
  min -= pad
  max += pad
  const range = max - min || 1

  const gap = gapDays(entries)
  const x = (date: string) => (daysBetween(first, date) / span) * VB_W
  const y = (kg: number) => VB_H - ((kg - min) / range) * VB_H

  // Split at long gaps so a fortnight off doesn't render as a confident straight line
  // between two distant readings.
  function toSegments(series: Array<{ date: string; kg: number }>): string[] {
    const segments: string[] = []
    let current: string[] = []
    let prev: string | null = null
    for (const p of series) {
      const pt: Pt = { x: x(p.date), y: y(p.kg), gapBefore: prev != null && daysBetween(prev, p.date) > gap }
      if (pt.gapBefore && current.length > 0) {
        segments.push(current.join(" "))
        current = []
      }
      current.push(`${pt.x.toFixed(2)},${pt.y.toFixed(2)}`)
      prev = p.date
    }
    if (current.length > 0) segments.push(current.join(" "))
    return segments.filter((s) => s.includes(" "))
  }

  const rawSegments = toSegments(entries)
  const avgSegments = toSegments(avg)
  const goalY = goalBw != null ? y(goalBw) : null

  return (
    <div>
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="none"
        className="w-full h-[140px]"
        aria-hidden="true"
      >
        {goalY != null && (
          <line
            x1="0"
            y1={goalY}
            x2={VB_W}
            y2={goalY}
            className="stroke-line-heavy"
            strokeWidth="1"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {rawSegments.map((points, i) => (
          <polyline
            key={`raw-${i}`}
            points={points}
            fill="none"
            className="stroke-brand-tint-3"
            strokeWidth="1.5"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {/* Zero-length round-capped strokes: dots that stay round under the stretched viewBox,
            so a reading cut off from its neighbours by a gap is still on the chart. */}
        {entries.length <= DOT_LIMIT &&
          entries.map((e) => (
            <line
              key={`dot-${e.date}`}
              x1={x(e.date)}
              y1={y(e.kg)}
              x2={x(e.date)}
              y2={y(e.kg)}
              className="stroke-brand-line"
              strokeWidth="5"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        {avgSegments.map((points, i) => (
          <polyline
            key={`avg-${i}`}
            points={points}
            fill="none"
            className="stroke-brand-line"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      <div className="flex justify-between mt-1.5">
        <span className="text-[10px] text-ink-7">{formatDay(first)}</span>
        <span className="text-[10px] text-ink-7">
          {formatDay(entries[entries.length - 1].date)}
        </span>
      </div>

      <div className="flex items-center gap-4 mt-3">
        <span className="flex items-center gap-1.5 text-[10px] text-ink-5">
          <span className="w-3 h-0.5 rounded bg-brand-line" />7-day average
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-ink-5">
          <span className="w-3 h-0.5 rounded bg-brand-tint-3" />readings
        </span>
        {goalBw != null && (
          <span className="flex items-center gap-1.5 text-[10px] text-ink-5">
            <span className="w-3 border-t border-dashed border-line-heavy" />goal
          </span>
        )}
      </div>
    </div>
  )
}
