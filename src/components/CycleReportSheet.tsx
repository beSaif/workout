"use client"

import { useState } from "react"
import { BlockPhase, CycleLength } from "@/lib/types"
import { CycleReport } from "@/lib/cycleReport"
import { blockLengthFor, CYCLE_LENGTHS, CYCLE_LENGTH_LABEL, loadStep, PHASE_SESSION_TYPE } from "@/lib/prescription"
import { PHASE_THEME } from "@/lib/phaseStyle"

interface CycleReportSheetProps {
  report: CycleReport
  /** Lift name for the copy, e.g. "Bench". */
  liftShort: string
  /** Start the next cycle at this peak, weekly frequency and length. */
  onStart: (peak: number, sessionsPerWeek: number, cycleLength: CycleLength) => void
  /** Close without changing anything: the next cycle keeps its suggested peak. */
  onClose: () => void
  /** What the next cycle is set to now, when the report is reopened after a change. */
  current?: { peak: number; sessionsPerWeek?: number; cycleLength?: CycleLength; setUp?: boolean }
}

const NEXT_PHASES: BlockPhase[] = ["accumulation", "transmutation", "realization", "deload"]
const DAYS = [2, 3, 4, 5, 6]

function pct(from: number, to: number): string {
  const p = ((to - from) / from) * 100
  return `${p >= 0 ? "+" : "−"}${Math.abs(p).toFixed(1)}%`
}

/** What the cycle showed, and two questions that set up the next one. */
export default function CycleReportSheet({ report, liftShort, onStart, onClose, current }: CycleReportSheetProps) {
  const step = loadStep(report.nextPeak)
  const [peak, setPeak] = useState(current?.peak ?? report.nextPeak)
  const [perWeek, setPerWeek] = useState(
    Math.min(6, Math.max(2, Math.round(current?.sessionsPerWeek ?? report.sessionsPerWeek)))
  )
  // Reopened after Start, the cycle keeps what was picked; the first time, it offers the suggestion.
  const [length, setLength] = useState<CycleLength>(
    current?.setUp && current.cycleLength ? current.cycleLength : report.suggestedLength
  )
  const lengthOf = (l: CycleLength) => NEXT_PHASES.reduce((n, phase) => n + blockLengthFor(phase, perWeek, { cycleLength: l }), 0)

  const raised = report.nextPeak > report.previousPeak
  const lowered = report.nextPeak < report.previousPeak
  const headline =
    report.outcome === "untested"
      ? `Peak stays ${report.nextPeak}kg`
      : raised
      ? `Peak ${report.previousPeak} → ${report.nextPeak}kg`
      : lowered
      ? `Peak ${report.previousPeak} → ${report.nextPeak}kg`
      : `Peak holds at ${report.nextPeak}kg`

  const testLine = !report.test
    ? "Peak single skipped"
    : report.test.reps === 0
    ? `Peak single: ${report.test.kg}kg missed`
    : `Peak single: ${report.test.kg}kg × ${report.test.reps}${report.test.rpe != null ? ` @ RPE ${report.test.rpe}` : ""}`

  const changeLine =
    report.change === "volume-up"
      ? "Volume days get a set more."
      : report.change === "volume-reset"
      ? "Volume days go back to their base sets."
      : report.change === "rep-range"
      ? "Two cycles without a new peak: Volume switches rep range."
      : null

  const sessions = report.phases.reduce((n, p) => n + p.sessions, 0)
  const skipped = report.phases.reduce((n, p) => n + p.skipped, 0)
  const rated = report.effort.onTarget + report.effort.harder + report.effort.easier

  const nextLength = lengthOf(length)
  const nextWeeks = Math.round(nextLength / perWeek)

  const peakOptions = [
    { label: "Ease off", kg: report.nextPeak - step },
    { label: "Suggested", kg: report.nextPeak },
    { label: "Push", kg: report.nextPeak + step },
  ].filter((o) => o.kg > 0)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
      <div className="bg-white w-full max-w-[393px] rounded-t-2xl max-h-[92dvh] overflow-y-auto">
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-start justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#aaaaaa]">
              Cycle {report.number} complete
            </p>
            <button onClick={onClose} aria-label="Close" className="text-[#aaaaaa] -mt-1 -mr-1 p-1 active:opacity-70">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
                <path d="M1.41 0L0 1.41 5.59 7 0 12.59 1.41 14 7 8.41 12.59 14 14 12.59 8.41 7 14 1.41 12.59 0 7 5.59 1.41 0z" />
              </svg>
            </button>
          </div>
          <div className="flex items-baseline gap-2 mt-1">
            <p className="text-2xl font-bold text-[#111111] tracking-tight">{headline}</p>
            {report.outcome !== "untested" && report.nextPeak !== report.previousPeak && (
              <span className={`text-xs font-semibold ${raised ? "text-[#2d6a2d]" : "text-[#8a4d14]"}`}>
                {pct(report.previousPeak, report.nextPeak)}
              </span>
            )}
          </div>
          <p className="text-sm text-[#777777] mt-1">{testLine}</p>
        </div>

        {/* Headline numbers */}
        <div className="grid grid-cols-2 gap-2 px-6">
          <Tile
            value={report.e1rm.during != null ? `${Math.round(report.e1rm.during * 10) / 10}` : "—"}
            label="Best e1RM"
            note={
              report.e1rm.during != null && report.e1rm.before != null
                ? `${report.e1rm.during >= report.e1rm.before ? "+" : "−"}${Math.abs(Math.round((report.e1rm.during - report.e1rm.before) * 10) / 10)}kg`
                : undefined
            }
          />
          <Tile value={String(sessions)} label="Sessions" note={skipped > 0 ? `${skipped} skipped` : undefined} />
        </div>

        {/* Phase by phase */}
        <div className="px-6 mt-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#aaaaaa] mb-2">By phase</p>
          <div className="rounded-xl border border-[#eeeeee] divide-y divide-[#eeeeee]">
            {report.phases.map((p) => (
              <div key={p.phase} className="flex items-center justify-between px-3 py-2.5">
                <span className="flex items-center gap-2">
                  <span className="w-1.5 h-3.5 rounded-full" style={{ backgroundColor: PHASE_THEME[p.phase].color }} />
                  <span className="text-sm font-medium text-[#333333]">{PHASE_SESSION_TYPE[p.phase]}</span>
                </span>
                <span className="text-xs text-[#888888] tabular-nums">
                  {p.sessions === 0 && p.skipped > 0
                    ? "skipped"
                    : `${p.sessions} session${p.sessions === 1 ? "" : "s"} · ${p.sets} set${p.sets === 1 ? "" : "s"}`}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* How it felt */}
        <div className="px-6 mt-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#aaaaaa] mb-2">How it felt</p>
          {rated > 0 ? (
            <p className="text-sm text-[#333333] leading-relaxed">
              {report.effort.onTarget} on target, {report.effort.harder} harder, {report.effort.easier} easier
              {report.effort.unrated > 0 ? `, ${report.effort.unrated} without an RPE` : ""}.
            </p>
          ) : (
            <p className="text-sm text-[#777777]">No RPEs logged this cycle, so loads only moved on missed reps.</p>
          )}
          <p className="text-sm text-[#777777] mt-1">
            {report.loadShift > 0
              ? `Loads ended ${report.loadShift}kg over plan: sessions kept feeling easy.`
              : report.loadShift < 0
              ? `Loads ended ${-report.loadShift}kg under plan${
                  report.missedSets > 0 ? ", after missed reps" : report.effort.harder > 0 ? ": sessions ran hard" : ""
                }.`
              : "Loads stayed on plan."}
            {report.missedSets > 0 ? ` ${report.missedSets} missed set${report.missedSets === 1 ? "" : "s"}.` : ""}
          </p>
          {changeLine && <p className="text-sm font-medium text-[#1e3a5f] mt-1">{changeLine}</p>}
        </div>

        {/* Next cycle */}
        <div className="px-6 mt-6 pt-5 border-t border-[#eeeeee]">
          <p className="text-base font-semibold text-[#111111]">Set up cycle {report.number + 1}</p>

          <p className="text-sm text-[#555555] mt-4 mb-2">What do you want to peak at?</p>
          <div className="grid grid-cols-3 gap-2">
            {peakOptions.map((o) => (
              <button
                key={o.label}
                onClick={() => setPeak(o.kg)}
                className={`rounded-xl border px-2 py-2.5 text-center transition-colors ${
                  peak === o.kg ? "border-[#1e3a5f] bg-[#eff6ff]" : "border-[#e8e8e8] bg-white"
                }`}
              >
                <span className="block text-base font-semibold text-[#111111] tabular-nums">{o.kg}kg</span>
                <span className="block text-[11px] text-[#888888]">{o.label}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center justify-center gap-4 mt-3">
            <button
              onClick={() => setPeak((p) => Math.max(step, p - 2.5))}
              aria-label="2.5kg less"
              className="w-9 h-9 rounded-full border border-[#e8e8e8] text-lg text-[#555555] active:opacity-70"
            >
              −
            </button>
            <span className="text-sm text-[#555555] tabular-nums min-w-[96px] text-center">
              <span className="font-semibold text-[#111111]">{peak}kg</span> {liftShort.toLowerCase()}
            </span>
            <button
              onClick={() => setPeak((p) => p + 2.5)}
              aria-label="2.5kg more"
              className="w-9 h-9 rounded-full border border-[#e8e8e8] text-lg text-[#555555] active:opacity-70"
            >
              +
            </button>
          </div>

          <p className="text-sm text-[#555555] mt-5 mb-2">How many days a week will you {liftShort.toLowerCase()}?</p>
          <div className="flex gap-2">
            {DAYS.map((d) => (
              <button
                key={d}
                onClick={() => setPerWeek(d)}
                className={`flex-1 rounded-xl border py-2.5 text-sm font-semibold transition-colors ${
                  perWeek === d ? "border-[#1e3a5f] bg-[#eff6ff] text-[#1e3a5f]" : "border-[#e8e8e8] text-[#555555]"
                }`}
              >
                {d}
              </button>
            ))}
          </div>

          <p className="text-sm text-[#555555] mt-5 mb-2">How long should the cycle be?</p>
          <div className="grid grid-cols-3 gap-2">
            {CYCLE_LENGTHS.map((l) => (
              <button
                key={l}
                onClick={() => setLength(l)}
                className={`rounded-xl border px-2 py-2.5 text-center transition-colors ${
                  length === l ? "border-[#1e3a5f] bg-[#eff6ff]" : "border-[#e8e8e8] bg-white"
                }`}
              >
                <span className="block text-sm font-semibold text-[#111111]">{CYCLE_LENGTH_LABEL[l]}</span>
                <span className="block text-[11px] text-[#888888]">
                  ~{Math.round(lengthOf(l) / perWeek)} weeks{l === report.suggestedLength ? " · suggested" : ""}
                </span>
              </button>
            ))}
          </div>
          {report.lengthReason && <p className="text-xs text-[#3b5f8a] mt-2">{report.lengthReason}</p>}
          <p className="text-xs text-[#999999] mt-2">
            {nextLength} sessions, about {nextWeeks} weeks
            {perWeek >= 4 ? ", with light days between the heavy ones" : ""}.
          </p>
        </div>

        <div className="px-6 pt-5 pb-10">
          <button
            onClick={() => onStart(peak, perWeek, length)}
            className="w-full bg-[#1e3a5f] text-white text-sm font-semibold rounded-xl py-3.5 active:bg-[#0f2540] transition-colors"
          >
            Start cycle {report.number + 1} · peak {peak}kg
          </button>
          <button onClick={onClose} className="w-full text-sm text-[#888888] py-3 mt-1 active:opacity-70">
            Later
          </button>
        </div>
      </div>
    </div>
  )
}

function Tile({ value, label, note }: { value: string; label: string; note?: string }) {
  return (
    <div className="rounded-xl bg-[#f7f7f7] px-3 py-3 text-center">
      <p className="text-lg font-bold text-[#111111] tabular-nums leading-tight">{value}</p>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#999999] mt-0.5">{label}</p>
      {note && (
        <p
          className={`text-[10px] mt-0.5 ${
            note.startsWith("+") ? "text-[#2d6a2d]" : note.startsWith("−") ? "text-[#8a4d14]" : "text-[#999999]"
          }`}
        >
          {note}
        </p>
      )}
    </div>
  )
}
