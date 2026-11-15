"use client"

import { useState } from "react"
import Link from "next/link"
import { Session, TrainingDay } from "@/lib/types"
import { MuscleGroupConfig } from "@/lib/exerciseConfig"
import {
  BALANCE_WINDOW_DAYS,
  Freshness,
  MuscleRecovery,
  STALE_DAYS,
  formatDays,
  muscleRecovery,
} from "@/lib/balance"

interface Props {
  /** Confirmed sessions, newest first. */
  sessions: Session[]
  exerciseConfig: MuscleGroupConfig[]
  trainingDays: TrainingDay[]
}

const STATE_COLOR: Record<Freshness, string> = {
  fresh: "#16a34a",
  due: "#b06a1e",
  stale: "#b3261e",
  never: "#cccccc",
}

function needsWork(r: MuscleRecovery): boolean {
  return r.days === null || r.days >= STALE_DAYS
}

/**
 * Whether the training is actually balanced.
 *
 * Collapsed to a single rail by default — one segment per muscle group, stalest
 * first — because a full bar chart pushed everything else down the screen. The
 * rail still shows at a glance how much red there is; tapping it opens the
 * detail. A full bar means the group is covered and an empty one means it has
 * been neglected, which is why this is "balance" rather than "recovery".
 */
export default function MuscleRecoveryBars({ sessions, exerciseConfig, trainingDays }: Props) {
  const [open, setOpen] = useState(false)
  const [metric, setMetric] = useState<"days" | "sets">("days")

  const rows = muscleRecovery(sessions, exerciseConfig, { trainingDays })
  if (rows.length === 0) return null

  const peakSets = Math.max(1, ...rows.map((r) => r.sets))
  const unscheduled = rows.filter((r) => r.inAnyDay === false).length
  const stale = rows.filter(needsWork).length
  const untrained = rows.every((r) => r.days === null)

  const summary = untrained
    ? "not tracked yet"
    : stale === 0
    ? "all trained recently"
    : `${stale} of ${rows.length} need work`

  return (
    <section data-ledge className="mb-3 px-4 py-3 rounded-xl bg-surface border border-line">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full text-left active:opacity-70 transition-opacity"
      >
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-6">
            Muscle balance
          </p>
          <span className="flex items-center gap-1 text-[11px] text-ink-5">
            {summary}
            <svg
              width="9"
              height="6"
              viewBox="0 0 9 6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
              className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            >
              <path d="M1 1.5L4.5 4.5L8 1.5" />
            </svg>
          </span>
        </div>

        {/* Collapsed: one labelled segment per group, stalest first, so which groups
            are neglected reads at a glance without costing a screen of height.
            Names truncate on narrow columns; the title carries the full text. */}
        {!open && (
          <div className="flex gap-1.5">
            {rows.map((r) => (
              <div
                key={r.id}
                title={`${r.label} · ${formatDays(r.days)}`}
                className="flex-1 min-w-0"
              >
                <div
                  className="h-1.5 rounded-full mb-1"
                  style={{ backgroundColor: STATE_COLOR[r.state] }}
                />
                <p className="text-[10px] font-medium text-ink-5 leading-tight truncate">
                  {r.label}
                </p>
              </div>
            ))}
          </div>
        )}
      </button>

      {open && (
        <>
          <div className="flex flex-col gap-[7px] animate-fade-up">
            {rows.map((r) => {
              const pct = metric === "days" ? r.freshness * 100 : (r.sets / peakSets) * 100
              const color = STATE_COLOR[r.state]
              return (
                <div key={r.id} className="flex items-center gap-2.5">
                  <span
                    title={r.label}
                    className="w-[74px] shrink-0 truncate text-[11px] font-semibold text-ink-3"
                  >
                    {r.label}
                    {r.inAnyDay === false && <span className="text-ink-7"> *</span>}
                  </span>
                  <div className="flex-1 min-w-0 h-1.5 rounded-full bg-surface-3 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      // Widths are inline because Tailwind cannot generate classes
                      // from runtime values. An empty bar keeps a small nub so a
                      // neglected group reads as neglected, not as missing data.
                      style={{ width: `${Math.max(pct, 4)}%`, backgroundColor: color }}
                    />
                  </div>
                  <span
                    className="w-[42px] shrink-0 text-right text-[11px] font-semibold tabular-nums"
                    style={{ color }}
                  >
                    {metric === "days" ? formatDays(r.days) : r.sets}
                  </span>
                </div>
              )
            })}
          </div>

          {untrained ? (
            <p className="mt-2.5 text-[11px] text-ink-5">
              Log a session to start tracking your balance
            </p>
          ) : (
            <button
              onClick={() => setMetric((v) => (v === "days" ? "sets" : "days"))}
              className="mt-2.5 text-[11px] font-semibold text-ink-5 hover:text-brand active:opacity-70 transition-colors"
            >
              {metric === "days" ? "days since" : `${BALANCE_WINDOW_DAYS}d sets`}
            </button>
          )}

          {unscheduled > 0 && (
            <p className="mt-2 text-[10px] text-ink-6">
              * not in any training day —{" "}
              <Link href="/exercises" className="underline">
                edit days
              </Link>
            </p>
          )}
        </>
      )}
    </section>
  )
}
