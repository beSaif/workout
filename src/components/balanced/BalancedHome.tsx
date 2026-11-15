"use client"

import { MuscleGroup, Session, TrainingDay } from "@/lib/types"
import { MuscleGroupConfig } from "@/lib/exerciseConfig"
import MuscleRecoveryBars from "./MuscleRecoveryBars"
import UpNextCard from "./UpNextCard"
import BalancedSessionRow from "./BalancedSessionRow"
import { daysSinceDate } from "@/lib/layoff"

interface Props {
  /** Confirmed sessions, newest first. */
  confirmedSorted: Session[]
  upcoming: Session | undefined
  exerciseConfig: MuscleGroupConfig[]
  trainingDays: TrainingDay[]
  recommendedDayId?: string
  /** Why the coach picked that day. */
  recommendedReason?: string
  mainLiftLabel: string
  onStartLogging: (session: Session) => void
  onUpdateMuscleGroups: (session: Session, muscles: MuscleGroup[], dayId?: string) => void
  onEdit: (session: Session) => void
  onUnlog: (session: Session) => void
  onShare: (session: Session) => void
}

/** Only the latest few sessions; the home screen is about what's next, not the archive. */
const RECENT_COUNT = 5

/** A week without training is how a layoff surfaces in this mode, since LayoffBanner is tied to blocks. */
const LAYOFF_DAYS = 7

function gapPill(daysSince: number): { text: string; className: string } {
  if (daysSince >= LAYOFF_DAYS) {
    return { text: `${daysSince}d off`, className: "bg-warn-tint text-warn-2" }
  }
  if (daysSince === 0) return { text: "trained today", className: "bg-good-tint text-good-bright" }
  return { text: `${daysSince}d since last`, className: "bg-surface-2 text-ink-5" }
}

/**
 * The Balanced home screen: what to do next, whether the training is balanced, and
 * what was done recently. There is no block or target here, so these
 * are the questions the screen has to answer on its own.
 */
export default function BalancedHome({
  confirmedSorted,
  upcoming,
  exerciseConfig,
  trainingDays,
  recommendedDayId,
  recommendedReason,
  mainLiftLabel,
  onStartLogging,
  onUpdateMuscleGroups,
  onEdit,
  onUnlog,
  onShare,
}: Props) {
  const recent = confirmedSorted.slice(0, RECENT_COUNT)
  const lastDate = confirmedSorted[0]?.date
  const pill = lastDate ? gapPill(daysSinceDate(lastDate)) : null

  return (
    <div className="mb-4">
      {upcoming && (
        <UpNextCard
          session={upcoming}
          history={confirmedSorted}
          exerciseConfig={exerciseConfig}
          trainingDays={trainingDays}
          recommendedDayId={recommendedDayId}
          reason={recommendedReason}
          onStartLogging={onStartLogging}
          onUpdateMuscleGroups={onUpdateMuscleGroups}
        />
      )}

      <MuscleRecoveryBars
        sessions={confirmedSorted}
        exerciseConfig={exerciseConfig}
        trainingDays={trainingDays}
      />

      {recent.length > 0 && (
        <section data-ledge className="mt-5 rounded-xl bg-surface border border-line overflow-hidden">
          <div className="flex items-baseline justify-between gap-2 px-4 pt-3 pb-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-6">
              Recent sessions
            </p>
            {pill && (
              <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${pill.className}`}>
                {pill.text}
              </span>
            )}
          </div>
          <div className="divide-y divide-line-soft border-t border-line-soft">
            {recent.map((s) => (
              <BalancedSessionRow
                key={s.id}
                session={s}
                exerciseConfig={exerciseConfig}
                trainingDays={trainingDays}
                mainLiftLabel={mainLiftLabel}
                onEdit={onEdit}
                onUnlog={onUnlog}
                onShare={onShare}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
