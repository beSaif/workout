"use client"

import { useState, useEffect } from "react"
import {
  UserProfile,
  MainLift,
  MAIN_LIFT_LABEL,
  TrainingMode,
  TRAINING_MODE_LABEL,
  TRAINING_MODE_DESC,
} from "@/lib/types"
import { loadProfile, loadProfileLocal, saveProfile } from "@/lib/storage"
import { getTrainingMode, hasLiftSetup } from "@/lib/trainingMode"

const MODES: TrainingMode[] = ["lift-focused", "balanced"]
const LIFTS: MainLift[] = ["bench", "deadlift", "squat"]

function roundTo2p5(kg: number): number {
  return Math.round(kg / 2.5) * 2.5
}

/**
 * "Training focus" control for the Exercise Selection page.
 * Lift-focused: one main lift opens every session, block periodization, a target.
 * Balanced: sessions follow the training day only; no main lift, no blocks.
 *
 * Switching to Balanced saves straight away. Switching to Lift-focused needs a lift,
 * anchor and target; if the profile lacks any of them a sheet collects them first.
 * Blocks are never touched here — the home page parks or resumes them by mode.
 */
export default function TrainingModeSelector() {
  const [profile, setProfile] = useState<UserProfile | null>(() =>
    typeof window === "undefined" ? null : loadProfileLocal()
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Lift setup sheet (shown when switching to lift-focused without lift/anchor/target)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [lift, setLift] = useState<MainLift | null>(null)
  const [anchor, setAnchor] = useState("")
  const [target, setTarget] = useState("")

  useEffect(() => {
    let cancelled = false
    loadProfile().then((p) => { if (!cancelled && p) setProfile(p) })
    return () => { cancelled = true }
  }, [])

  const current = getTrainingMode(profile)

  async function persist(next: Omit<UserProfile, "email" | "createdAt">) {
    setSaving(true)
    setError(null)
    const updated = await saveProfile(next)
    setSaving(false)
    if (!updated) {
      setError("Couldn't save. Check your connection and try again.")
      return false
    }
    setProfile(updated)
    return true
  }

  async function choose(mode: TrainingMode) {
    if (!profile || saving || mode === current) return

    if (mode === "balanced") {
      await persist({
        name: profile.name,
        bw: profile.bw,
        trainingMode: "balanced",
        mainLift: profile.mainLift,
        anchor: profile.anchor,
        target: profile.target,
      })
      return
    }

    if (hasLiftSetup(profile)) {
      await persist({
        name: profile.name,
        bw: profile.bw,
        trainingMode: "lift-focused",
        mainLift: profile.mainLift,
        anchor: profile.anchor,
        target: profile.target,
      })
      return
    }

    setLift(profile.mainLift ?? null)
    setAnchor(profile.anchor != null ? String(profile.anchor) : "")
    setTarget(profile.target != null ? String(profile.target) : "")
    setSheetOpen(true)
  }

  const anchorVal = parseFloat(anchor)
  const targetVal = parseFloat(target)
  const sheetValid =
    lift !== null &&
    Number.isFinite(anchorVal) && anchorVal > 0 &&
    Number.isFinite(targetVal) && targetVal > 0

  const targetSuggestions: { kg: number; label: string }[] =
    Number.isFinite(anchorVal) && anchorVal > 0
      ? [
          { kg: roundTo2p5(anchorVal * 1.1), label: "+10%" },
          { kg: roundTo2p5(anchorVal * 1.2), label: "+20%" },
          { kg: roundTo2p5(anchorVal * 1.3), label: "+30%" },
        ]
      : []

  async function confirmSheet() {
    if (!profile || !sheetValid || lift === null) return
    const ok = await persist({
      name: profile.name,
      bw: profile.bw,
      trainingMode: "lift-focused",
      mainLift: lift,
      anchor: anchorVal,
      target: targetVal,
    })
    if (ok) setSheetOpen(false)
  }

  if (!profile) return null

  return (
    <>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-6 mb-3">
        Training Focus
      </p>
      {/* Two short segments rather than two cards: only the chosen mode is explained. */}
      <div className="mb-8">
        <div className="flex gap-1 p-1 rounded-xl bg-surface-2">
          {MODES.map((mode) => {
            const selected = mode === current
            return (
              <button
                key={mode}
                onClick={() => choose(mode)}
                disabled={saving}
                aria-pressed={selected}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-60 ${
                  selected ? "bg-surface-pop text-brand shadow-sm" : "text-ink-5 hover:text-ink-2"
                }`}
              >
                {TRAINING_MODE_LABEL[mode]}
              </button>
            )
          })}
        </div>
        <p className="text-[11px] text-ink-5 mt-2 leading-snug">{TRAINING_MODE_DESC[current]}</p>
        {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
      </div>

      {/* Lift setup sheet: needed before lift-focused mode can prescribe anything */}
      {sheetOpen && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
          <div className="bg-raised w-full max-w-[393px] rounded-t-2xl px-6 pt-6 pb-10 max-h-[90dvh] overflow-y-auto">
            <p className="text-base font-semibold text-ink mb-1">Set up your main lift</p>
            <p className="text-sm text-ink-5 mb-5">
              Lift-focused mode prescribes every session as a percentage of your current max, so it needs these three things.
            </p>

            <label className="block text-[10px] font-semibold uppercase tracking-widest text-ink-6 mb-2">
              Lift
            </label>
            <div className="flex gap-2 mb-5">
              {LIFTS.map((l) => (
                <button
                  key={l}
                  onClick={() => setLift(l)}
                  className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-semibold transition-colors ${
                    lift === l
                      ? "border-brand-line bg-brand-tint text-brand"
                      : "border-line text-ink hover:border-line-strong"
                  }`}
                >
                  {MAIN_LIFT_LABEL[l]}
                </button>
              ))}
            </div>

            <label className="block text-[10px] font-semibold uppercase tracking-widest text-ink-6 mb-2">
              Current 1RM (kg)
            </label>
            <input
              type="number"
              inputMode="decimal"
              step="2.5"
              value={anchor}
              onChange={(e) => setAnchor(e.target.value)}
              placeholder="100"
              className="w-full border border-line rounded-xl px-4 py-3 text-xl font-semibold text-ink mb-5 focus:outline-none focus:border-brand-line"
            />

            <label className="block text-[10px] font-semibold uppercase tracking-widest text-ink-6 mb-2">
              Goal weight (kg)
            </label>
            {targetSuggestions.length > 0 && (
              <div className="flex gap-2 mb-2">
                {targetSuggestions.map(({ kg, label }) => (
                  <button
                    key={kg}
                    onClick={() => setTarget(String(kg))}
                    className={`flex-1 flex flex-col items-center py-2 rounded-xl border-2 transition-colors ${
                      target === String(kg)
                        ? "border-brand-line bg-brand-tint text-brand"
                        : "border-line text-ink hover:border-line-strong"
                    }`}
                  >
                    <span className="text-sm font-semibold">{kg}kg</span>
                    <span className="text-[10px] text-ink-6">{label}</span>
                  </button>
                ))}
              </div>
            )}
            <input
              type="number"
              inputMode="decimal"
              step="2.5"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="140"
              className="w-full border border-line rounded-xl px-4 py-3 text-xl font-semibold text-ink mb-6 focus:outline-none focus:border-brand-line"
            />

            {error && <p className="text-sm text-red-500 mb-3">{error}</p>}
            <button
              onClick={confirmSheet}
              disabled={!sheetValid || saving}
              className="w-full bg-brand-fill text-white text-sm font-semibold rounded-xl py-3.5 hover:bg-brand-fill-2 active:bg-brand-fill-3 transition-colors disabled:opacity-40"
            >
              {saving ? "Saving…" : "Switch to Lift-focused"}
            </button>
            <button
              onClick={() => setSheetOpen(false)}
              disabled={saving}
              className="w-full text-xs text-ink-6 hover:text-ink-4 active:text-ink-2 transition-colors pt-3"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  )
}
