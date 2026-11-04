"use client"

import { LiftProgress } from "@/lib/progress"

interface ProgressCardProps {
  progress: LiftProgress
  /** The goal from the profile, in kg. */
  target: number
  /** Latest bodyweight in kg, for strength relative to it. */
  bodyweight: number | null
  /** Short lift name, e.g. "Bench". */
  liftShort: string
}

function kg(v: number): string {
  return String(Math.round(v * 10) / 10)
}

/**
 * Home's headline for the main lift: the best e1RM against the goal, the peak the program
 * is building to on the same bar, the pace to the goal, and three supporting numbers.
 */
export default function ProgressCard({ progress, target, bodyweight, liftShort }: ProgressCardProps) {
  const { e1rm, cycleGain, peak, peakIsNext, bestLift, cyclesToGoal, sessions } = progress
  const hasGoal = target > 0
  const share = (v: number) => Math.min(100, Math.max(0, (v / target) * 100))
  const fill = hasGoal && e1rm != null ? share(e1rm) : 0
  // The tick marks the peak only while it sits short of the goal, where it can be told apart.
  const tick = hasGoal && peak != null && peak < target ? share(peak) : null
  const toGo = hasGoal && e1rm != null ? Math.max(0, target - e1rm) : null
  const reached = toGo === 0

  return (
    <div className="rounded-2xl border border-[#e8e8e8] p-4 mb-5">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[#999999]">
          {liftShort} e1RM
        </span>
        {hasGoal && (
          <span className="text-xs text-[#777777]">
            Goal <span className="font-semibold text-[#111111] tabular-nums">{kg(target)}kg</span>
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-2.5 mt-1">
        <span className="text-[44px] font-extrabold leading-none tracking-tight text-[#1e3a5f] tabular-nums">
          {e1rm != null ? kg(e1rm) : "—"}
          {e1rm != null && <span className="text-[22px]">kg</span>}
        </span>
        {cycleGain > 0 && (
          <span className="text-xs font-semibold text-[#2d6a2d]">▲ {kg(cycleGain)}kg this cycle</span>
        )}
      </div>

      {hasGoal && (
        <>
          <div className="relative h-2 rounded-full bg-[#dbe4ef] mt-4" role="meter" aria-valuemin={0} aria-valuemax={target} aria-valuenow={e1rm ?? 0} aria-label={`e1RM against the ${kg(target)}kg goal`}>
            <div className="absolute inset-y-0 left-0 rounded-full bg-[#1e3a5f] transition-all duration-500" style={{ width: `${fill}%` }} />
            {tick != null && (
              <span className="absolute -top-1 h-4 w-0.5 rounded-sm bg-[#111111]" style={{ left: `${tick}%` }} />
            )}
          </div>
          <div className="relative h-4 mt-1 text-[10px] text-[#777777]">
            {tick != null && peak != null && (
              <span className="absolute whitespace-nowrap" style={{ right: `calc(${100 - tick}% + 6px)` }}>
                {peakIsNext ? "next peak" : "peak"} <span className="font-semibold text-[#111111] tabular-nums">{kg(peak)}</span>
              </span>
            )}
            <span className="absolute right-0 font-semibold text-[#111111] tabular-nums">{kg(target)}</span>
          </div>
          <p className="text-xs text-[#555555] mt-2">
            {reached ? (
              <span className="font-semibold text-[#111111]">Goal reached. Time to set a new one.</span>
            ) : toGo != null ? (
              <>
                <span className="font-semibold text-[#111111]">{kg(toGo)}kg to go</span>
                {cyclesToGoal != null &&
                  ` · about ${cyclesToGoal} cycle${cyclesToGoal === 1 ? "" : "s"} at your current pace`}
              </>
            ) : (
              "Log a session to see where you stand."
            )}
          </p>
        </>
      )}

      <div className="flex border-t border-[#e8e8e8] mt-3.5 pt-3">
        <Stat value={bestLift ? `${kg(bestLift.kg)} × ${bestLift.reps}` : "—"} label="best lift" />
        <Stat
          value={e1rm != null && bodyweight ? `${(e1rm / bodyweight).toFixed(2)}×` : "—"}
          label="bodyweight"
        />
        <Stat value={String(sessions)} label="sessions" />
      </div>
    </div>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex-1 min-w-0">
      <p className="text-base font-bold text-[#111111] tabular-nums leading-tight">{value}</p>
      <p className="text-[11px] text-[#999999]">{label}</p>
    </div>
  )
}
