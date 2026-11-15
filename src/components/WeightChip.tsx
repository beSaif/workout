"use client"

import Link from "next/link"
import { WeightEntry } from "@/lib/types"
import { delta, latestEntry } from "@/lib/weight"

interface Props {
  entries: WeightEntry[]
  /** The log hasn't arrived yet: show nothing rather than claim it's empty. */
  loading?: boolean
  /** Opens the check-in sheet for today. Only reachable from here before the first weigh-in. */
  onLog: () => void
}

const CHIP =
  "shrink-0 flex items-baseline gap-1 rounded-full border border-[#e8e8e8] px-2 py-0.5 text-xs font-bold text-[#111111] tabular-nums active:opacity-70 transition-opacity"

/**
 * Bodyweight has no universally "good" direction — a cut and a bulk want opposite
 * signs — so the delta is coloured by size, not by direction: a big weekly swing is
 * worth noticing either way, a small one is just water and is left out.
 */
function deltaLabel(d: number | null): { text: string; className: string } | null {
  if (d === null || Math.abs(d) < 0.3) return null
  const text = `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}`
  return { text, className: Math.abs(d) >= 1.5 ? "text-[#b06a1e]" : "text-[#16a34a]" }
}

/**
 * Bodyweight in the home header: the latest reading and the weekly change, in the
 * otherwise empty space beside the greeting. Tapping it opens /weight, which has the
 * chart and the way to log.
 */
export default function WeightChip({ entries, loading = false, onLog }: Props) {
  const latest = latestEntry(entries)

  if (!latest) {
    if (loading) return null
    return (
      <button type="button" onClick={onLog} className={`${CHIP} font-semibold text-[#1e3a5f]`}>
        + weight
      </button>
    )
  }

  const change = deltaLabel(delta(entries, 7))

  return (
    <Link href="/weight" aria-label={`Bodyweight ${latest.kg.toFixed(1)} kilograms, open weight log`} className={CHIP}>
      {latest.kg.toFixed(1)}
      <span className="text-[10px] font-semibold text-[#aaaaaa]">kg</span>
      {change && <span className={`text-[10px] font-semibold ${change.className}`}>{change.text}</span>}
    </Link>
  )
}
