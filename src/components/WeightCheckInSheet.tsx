"use client"

import { useState } from "react"
import { DrumRollPicker } from "@/components/DrumRollPicker"
import { WeightEntry } from "@/lib/types"
import { dateKey, describeDay, entryFor, latestEntry } from "@/lib/weight"
import EscapeKey from "@/components/EscapeKey"

// Two drums rather than one: 0.1kg precision over a sane bodyweight range is ~1650
// values, and the picker renders every item. Whole kg plus a decimal drum keeps the
// DOM small and reads the way a scale does.
const WHOLE_VALUES = Array.from({ length: 171 }, (_, i) => 30 + i)
const DECIMAL_VALUES = Array.from({ length: 10 }, (_, i) => i)

interface Props {
  entries: WeightEntry[]
  /** The day being logged. Defaults to today; /weight passes a past date to backfill. */
  date?: string
  /** Seed for the picker when the day has no entry yet — usually the last weigh-in. */
  fallbackKg: number
  onSave: (date: string, kg: number) => void
  onClose: () => void
  /** "skip this week" is only offered for the weekly prompt, not for a manual log. */
  skippable?: boolean
}

export default function WeightCheckInSheet({
  entries,
  date,
  fallbackKg,
  onSave,
  onClose,
  skippable = false,
}: Props) {
  const day = date ?? dateKey()
  const existing = entryFor(entries, day)
  const seed = existing?.kg ?? fallbackKg

  const [whole, setWhole] = useState(() =>
    Math.min(200, Math.max(30, Math.floor(seed)))
  )
  const [decimal, setDecimal] = useState(() => Math.round((seed - Math.floor(seed)) * 10))

  const latest = latestEntry(entries)
  const kg = Math.round((whole + decimal / 10) * 10) / 10

  // The nudge: what the number replaces, or the last one to compare against.
  const nudge = existing
    ? `logged ${describeDay(day)} — this replaces it`
    : latest
      ? `last one: ${latest.kg.toFixed(1)}kg, ${describeDay(latest.date)}`
      : "first one. from here it's a trend."

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
      <EscapeKey onEscape={onClose} />
      <div className="w-full max-w-[430px] bg-raised rounded-t-2xl px-6 pt-6 pb-10 shadow-2xl max-h-[90dvh] overflow-y-auto">
        <div className="mb-4">
          <p className="text-lg font-semibold text-ink leading-snug mb-1">
            {date && day !== dateKey()
              ? `weight for ${describeDay(day)}`
              : "what did you weigh in at?"}
          </p>
          <p className="text-sm text-ink-5">{nudge}</p>
        </div>

        <div className="flex items-end justify-center gap-2 mb-2">
          <DrumRollPicker
            values={WHOLE_VALUES}
            selected={whole}
            onChange={(v) => { if (v !== null) setWhole(v) }}
            label="kg"
          />
          <DrumRollPicker
            values={DECIMAL_VALUES}
            selected={decimal}
            onChange={(v) => { if (v !== null) setDecimal(v) }}
            label=""
            format={(v) => (v == null ? "—" : `.${v}`)}
          />
        </div>

        <p className="text-center text-sm text-ink-6 mb-6 tabular-nums">
          {kg.toFixed(1)} kg
        </p>

        <button
          onClick={() => onSave(day, kg)}
          className="w-full bg-brand-fill text-white text-sm font-semibold rounded-xl py-3.5 active:bg-brand-fill-3 transition-colors"
        >
          {existing ? "update" : "log it"}
        </button>
        <button onClick={onClose} className="w-full text-sm text-ink-6 py-3 mt-1">
          {skippable ? "skip this week" : "cancel"}
        </button>
      </div>
    </div>
  )
}
