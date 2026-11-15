"use client"

import { useCallback, useState } from "react"
import { UserProfile } from "@/lib/types"
import { saveProfile } from "@/lib/storage"

interface Props {
  saving: boolean
  error: string | null
  onAccept: () => void
  onDecline: () => void
}

/**
 * The one-time "do you want this?" for users who already had an account when weight
 * check-ins shipped. New users get the same question inside onboarding instead, so
 * this never fires for them.
 */
export default function WeightOptInSheet({ saving, error, onAccept, onDecline }: Props) {
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
      <div className="w-full max-w-[430px] bg-raised rounded-t-2xl px-6 pt-6 pb-10 shadow-2xl max-h-[90dvh] overflow-y-auto">
        <div className="mb-6">
          <p className="text-lg font-semibold text-ink leading-snug mb-1">
            want to check in your weight weekly?
          </p>
          <p className="text-sm text-ink-5">
            one number, once a week — log more often with the + whenever you like. strength is
            relative to bodyweight; tracking it is how you find out whether you&apos;re actually gaining, or just
            heavier.
          </p>
        </div>

        {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

        <button
          onClick={onAccept}
          disabled={saving}
          className="w-full bg-brand-fill text-white text-sm font-semibold rounded-xl py-3.5 active:bg-brand-fill-3 transition-colors disabled:opacity-40"
        >
          {saving ? "saving…" : "yeah, ask me weekly"}
        </button>
        <button
          onClick={onDecline}
          disabled={saving}
          className="w-full text-sm text-ink-6 py-3 mt-1 disabled:opacity-40"
        >
          no thanks
        </button>
      </div>
    </div>
  )
}

// ── Hook for consumers ────────────────────────────────────────────────────────

/**
 * Mirrors `useInstallGuide`, except the answer lives on the profile rather than in
 * localStorage — the weight log syncs to KV, so a second device must not re-ask
 * someone who already has months of entries.
 */
export function useWeightOptIn(onAnswered: (profile: UserProfile) => void) {
  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trigger = useCallback((profile: UserProfile | null) => {
    // Absent means never asked. `false` is a real answer and must stay respected.
    if (profile && profile.weighInDaily === undefined) setShow(true)
  }, [])

  /** Resolves to the saved profile, or null when the save failed and nothing changed. */
  const answer = useCallback(
    async (profile: UserProfile, weighInDaily: boolean): Promise<UserProfile | null> => {
      setSaving(true)
      setError(null)
      const updated = await saveProfile({
        name: profile.name,
        bw: profile.bw,
        trainingMode: profile.trainingMode,
        mainLift: profile.mainLift,
        anchor: profile.anchor,
        target: profile.target,
        goalBw: profile.goalBw,
        weighInDaily,
      })
      setSaving(false)
      if (!updated) {
        // saveProfile is remote-first and persists nothing on failure, so leave the
        // sheet up rather than pretending the choice stuck.
        setError("couldn't save that. check your connection and try again.")
        return null
      }
      setShow(false)
      onAnswered(updated)
      return updated
    },
    [onAnswered],
  )

  return { show, saving, error, trigger, answer }
}
