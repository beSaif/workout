"use client"

import { strengthRatio } from "@/lib/weight"

interface Props {
  /** Best e1RM on the main lift, from getBestE1RM. */
  e1rm: number | null
  /** Current bodyweight — the newest weigh-in. */
  bw: number | null
  /** Target lift from the profile. */
  target?: number
  /** Goal bodyweight, when set. Falls back to current bw so the target ratio still means something. */
  goalBw?: number
  liftLabel: string
}

/**
 * The number the whole goal is really about: a 140kg bench at 60kg bodyweight is a
 * 2.33× ratio, and it moves whether you add to the bar or take weight off yourself.
 * Lift-focused mode only — Balanced users have no main lift or target to compare to.
 */
export default function StrengthRatioPanel({ e1rm, bw, target, goalBw, liftLabel }: Props) {
  const current = strengthRatio(e1rm, bw)
  const goalWeight = goalBw ?? bw
  const targetRatio = strengthRatio(target ?? null, goalWeight ?? null)

  if (current == null && targetRatio == null) return null

  const pct =
    current != null && targetRatio != null && targetRatio > 0
      ? Math.min(100, Math.round((current / targetRatio) * 100))
      : null

  return (
    <section className="mb-4 px-4 py-4 rounded-xl bg-surface-2 border border-line">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-6 mb-3">
        Strength to bodyweight
      </p>

      <div className="flex items-baseline gap-1.5 mb-1">
        <span
          className={`text-3xl font-bold leading-none tabular-nums ${
            current != null ? "text-ink" : "text-ink-8"
          }`}
        >
          {current != null ? `${current.toFixed(2)}×` : "—"}
        </span>
        {targetRatio != null && (
          <span className="ml-auto text-[11px] text-ink-5 tabular-nums">
            goal {targetRatio.toFixed(2)}×
          </span>
        )}
      </div>

      <p className="text-xs text-ink-6 mb-3">
        {e1rm != null && bw != null
          ? `${e1rm}kg ${liftLabel.toLowerCase()} e1RM ÷ ${bw.toFixed(1)}kg bodyweight`
          : "log a session and a weigh-in to see this"}
      </p>

      {pct != null && (
        <div className="h-1.5 rounded-full bg-surface-4 overflow-hidden">
          {/* Width comes from data, which Tailwind cannot generate a class for. */}
          <div
            className="h-full rounded-full bg-brand-fill transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </section>
  )
}
