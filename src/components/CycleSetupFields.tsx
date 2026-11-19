"use client"

import { BlockPhase, CycleLength } from "@/lib/types"
import { blockLengthFor, CYCLE_LENGTHS, CYCLE_LENGTH_LABEL } from "@/lib/prescription"

const CYCLE_PHASES: BlockPhase[] = ["accumulation", "transmutation", "realization", "deload"]
const DAYS = [2, 3, 4, 5, 6]

interface CycleSetupFieldsProps {
  /** Lift name for the copy, e.g. "Bench". */
  liftShort: string
  peak: number
  onPeak: (kg: number) => void
  /** The lightest peak the stepper goes down to. */
  minPeak: number
  perWeek: number
  onPerWeek: (days: number) => void
  length: CycleLength
  onLength: (length: CycleLength) => void
  /** Marks one length as suggested, with why when there's a reason to give. */
  suggestedLength?: CycleLength
  lengthReason?: string | null
}

/**
 * What a cycle is set up with: a fine stepper for the peak, how many days a week, and how
 * long it runs, with the sessions and weeks that come to. Shared by the cycle report and
 * the restart sheet.
 */
export default function CycleSetupFields({
  liftShort,
  peak,
  onPeak,
  minPeak,
  perWeek,
  onPerWeek,
  length,
  onLength,
  suggestedLength,
  lengthReason,
}: CycleSetupFieldsProps) {
  const sessionsOf = (l: CycleLength) => CYCLE_PHASES.reduce((n, phase) => n + blockLengthFor(phase, perWeek, { cycleLength: l }), 0)
  const total = sessionsOf(length)
  const lift = liftShort.toLowerCase()

  return (
    <>
      <div className="flex items-center justify-center gap-4 mt-3">
        <button
          onClick={() => onPeak(Math.max(minPeak, peak - 2.5))}
          aria-label="2.5kg less"
          className="w-9 h-9 rounded-full border border-line text-lg text-ink-4 active:opacity-70"
        >
          −
        </button>
        <span className="text-sm text-ink-4 tabular-nums min-w-[96px] text-center">
          <span className="font-semibold text-ink">{peak}kg</span> {lift}
        </span>
        <button
          onClick={() => onPeak(peak + 2.5)}
          aria-label="2.5kg more"
          className="w-9 h-9 rounded-full border border-line text-lg text-ink-4 active:opacity-70"
        >
          +
        </button>
      </div>

      <p className="text-sm text-ink-4 mt-5 mb-2">How many days a week will you {lift}?</p>
      <div className="flex gap-2">
        {DAYS.map((d) => (
          <button
            key={d}
            onClick={() => onPerWeek(d)}
            className={`flex-1 rounded-xl border py-2.5 text-sm font-semibold transition-colors ${
              perWeek === d ? "border-brand-line bg-brand-tint text-brand" : "border-line text-ink-4"
            }`}
          >
            {d}
          </button>
        ))}
      </div>

      <p className="text-sm text-ink-4 mt-5 mb-2">How long should the cycle be?</p>
      <div className="grid grid-cols-3 gap-2">
        {CYCLE_LENGTHS.map((l) => (
          <button
            key={l}
            onClick={() => onLength(l)}
            className={`rounded-xl border px-2 py-2.5 text-center transition-colors ${
              length === l ? "border-brand-line bg-brand-tint" : "border-line bg-surface"
            }`}
          >
            <span className="block text-sm font-semibold text-ink">{CYCLE_LENGTH_LABEL[l]}</span>
            <span className="block text-[11px] text-ink-5">
              ~{Math.round(sessionsOf(l) / perWeek)} weeks{l === suggestedLength ? " · suggested" : ""}
            </span>
          </button>
        ))}
      </div>
      {lengthReason && <p className="text-xs text-brand-soft mt-2">{lengthReason}</p>}
      <p className="text-xs text-ink-6 mt-2">
        {total} sessions, about {Math.round(total / perWeek)} weeks. Volume and Intensity run heavy, light,
        medium, in that order.
      </p>
    </>
  )
}
