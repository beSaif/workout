"use client"

import { useState } from "react"
import Link from "next/link"
import { Session, TrainingDay } from "@/lib/types"
import { MuscleGroupConfig, getMuscleLabel } from "@/lib/exerciseConfig"
import { getSessionLabel } from "@/lib/trainingMode"
import { sessionWork } from "@/lib/stats"
import { relativeDate } from "@/lib/time"

interface Props {
  session: Session
  exerciseConfig: MuscleGroupConfig[]
  trainingDays: TrainingDay[]
  /** Labels the top set of sessions carried over from lift-focused mode. */
  mainLiftLabel: string
  onEdit: (session: Session) => void
  onUnlog: (session: Session) => void
  onShare: (session: Session) => void
}

/** Muscle chips shown before collapsing the rest into "+N". */
const MAX_CHIPS = 3

/**
 * A logged Balanced session, as one row of the home screen's recent-sessions card.
 *
 * The shared SessionCard reads its numbers from `session.sets`, which a Balanced
 * session never has — every set lives in `extraWorkouts` instead, so those cards
 * render blank. `sessionWork` is the summary that covers both.
 */
export default function BalancedSessionRow({
  session,
  exerciseConfig,
  trainingDays,
  mainLiftLabel,
  onEdit,
  onUnlog,
  onShare,
}: Props) {
  const [open, setOpen] = useState(false)
  const work = sessionWork(session, mainLiftLabel)
  const label = getSessionLabel(session, trainingDays)
  const logged = work.sets > 0

  const date = session.date ? new Date(session.date) : null
  const validDate = date != null && !isNaN(date.getTime())
  const chips = work.muscles.slice(0, MAX_CHIPS)
  const hiddenChips = work.muscles.length - chips.length

  const detail = [
    work.topSet && `top ${work.topSet.kg}kg × ${work.topSet.reps} — ${work.topSet.exercise}`,
    work.cardioMinutes > 0 && `${work.cardioMinutes} min cardio`,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <article>
      <div className="flex items-center gap-3 pl-4">
        <div
          title={session.date ? relativeDate(session.date) : undefined}
          className="shrink-0 w-10 h-11 rounded-lg bg-surface-2 flex flex-col items-center justify-center"
        >
          <span className="text-[15px] font-bold text-ink leading-none tabular-nums">
            {validDate ? date.getDate() : "–"}
          </span>
          <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-6 leading-none">
            {validDate ? date.toLocaleDateString(undefined, { weekday: "short" }) : ""}
          </span>
        </div>

        <Link
          href={`/session/${session.id}`}
          className="flex-1 min-w-0 py-3 active:opacity-70 transition-opacity"
        >
          <p className="text-[13px] font-bold text-ink truncate">{label}</p>

          {chips.length > 0 && (
            <div className="flex gap-1 mt-1 overflow-hidden">
              {chips.map((id) => (
                <span
                  key={id}
                  className="shrink-0 text-[10px] font-medium text-ink-5 bg-surface-2 rounded px-1.5 py-px"
                >
                  {getMuscleLabel(exerciseConfig, id)}
                </span>
              ))}
              {hiddenChips > 0 && (
                <span className="shrink-0 text-[10px] font-medium text-ink-6 px-0.5 py-px">
                  +{hiddenChips}
                </span>
              )}
            </div>
          )}

          {logged ? (
            detail && <p className="mt-1 text-[11px] text-ink-5 truncate">{detail}</p>
          ) : (
            <p className="mt-1 text-[11px] text-ink-6">No sets logged</p>
          )}
        </Link>

        <div className="shrink-0 flex flex-col items-end self-stretch justify-center">
          <Link
            href={`/session/${session.id}`}
            className="pr-4 pt-2 text-right active:opacity-70 transition-opacity"
          >
            <span className="block text-lg font-bold text-ink leading-none tabular-nums">
              {work.sets}
            </span>
            <span className="block mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-ink-6">
              sets
            </span>
          </Link>
          <button
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Hide session actions" : "Show session actions"}
            aria-expanded={open}
            className="px-4 py-2 text-ink-7 hover:text-ink-5 active:opacity-70 transition-colors"
          >
            <svg width="16" height="4" viewBox="0 0 16 4" fill="currentColor" aria-hidden="true">
              <circle cx="2" cy="2" r="1.6" />
              <circle cx="8" cy="2" r="1.6" />
              <circle cx="14" cy="2" r="1.6" />
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <div className="flex gap-2 px-4 pb-3 pt-1 animate-fade-up">
          <button
            onClick={() => onShare(session)}
            className="text-xs font-semibold text-brand border border-brand-line rounded-lg px-3 py-1.5 hover:bg-brand-fill hover:text-white transition-colors"
          >
            Share
          </button>
          <button
            onClick={() => onEdit(session)}
            className="text-xs font-semibold text-brand border border-brand-line rounded-lg px-3 py-1.5 hover:bg-brand-fill hover:text-white transition-colors"
          >
            Edit
          </button>
          <button
            onClick={() => onUnlog(session)}
            className="text-xs font-semibold text-ink-6 border border-line rounded-lg px-3 py-1.5 hover:border-line-heavy transition-colors"
          >
            Unlog
          </button>
        </div>
      )}
    </article>
  )
}
