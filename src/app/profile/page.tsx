"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { signOut } from "next-auth/react"
import Link from "next/link"
import { UserProfile, TRAINING_MODE_LABEL } from "@/lib/types"
import { isLiftFocused, getMainLiftLabel, getTrainingMode } from "@/lib/trainingMode"
import {
  loadProfile,
  profileCache,
  saveProfile,
  loadAll,
  sessionsCache,
  loadWeights,
  weightsCache,
  wipeLocalUserData,
} from "@/lib/storage"
import { useCachedState } from "@/lib/useLocalValue"
import { getBestE1RM, getBestWeight, getLatestBW } from "@/lib/stats"
import ProgressBar from "@/components/ProgressBar"
import { formatDay, latestEntry } from "@/lib/weight"
import BackButton from "@/components/BackButton"
import EscapeKey from "@/components/EscapeKey"

function formatJoined(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return "—"
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" })
}

interface ProfileForm {
  name: string
  bw: string
  target: string
  weighInDaily: boolean
}

function formFor(p: UserProfile | null): ProfileForm {
  return {
    name: p?.name ?? "",
    bw: p ? String(p.bw) : "",
    target: p?.target != null ? String(p.target) : "",
    // Never asked reads as off here; the home screen is what does the asking.
    weighInDaily: p?.weighInDaily === true,
  }
}

export default function ProfilePage() {
  const router = useRouter()
  // The cached copies paint at once; the network replies replace them.
  const [cachedProfile, setProfile] = useCachedState(profileCache)
  const [cachedSessions, setSessions] = useCachedState(sessionsCache)
  const [cachedWeights, setWeights] = useCachedState(weightsCache)
  const profile = cachedProfile ?? null
  const sessions = cachedSessions ?? []
  const weights = cachedWeights ?? []

  /** The form as edited; null shows the profile as it stands. */
  const [draft, setDraft] = useState<ProfileForm | null>(null)
  const { name, bw, target, weighInDaily } = draft ?? formFor(profile)
  function edit(change: Partial<ProfileForm> | ((form: ProfileForm) => Partial<ProfileForm>)) {
    setDraft((d) => {
      const form = d ?? formFor(profile)
      return { ...form, ...(typeof change === "function" ? change(form) : change) }
    })
  }

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const seedForm = useCallback(
    (p: UserProfile) => {
      setProfile(p)
      setDraft(null)
    },
    [setProfile]
  )

  useEffect(() => {
    let cancelled = false

    loadWeights().then((data) => {
      if (!cancelled) setWeights(data)
    })

    loadProfile().then((p) => {
      if (cancelled) return
      if (!p) {
        router.replace("/onboarding")
        return
      }
      seedForm(p)
    })

    loadAll().then(({ sessions: data }) => {
      if (cancelled) return
      setSessions(data)
    })

    return () => {
      cancelled = true
    }
  }, [router, seedForm, setSessions, setWeights])

  const liftFocused = isLiftFocused(profile)
  const bwVal = parseFloat(bw)
  const targetVal = parseFloat(target)
  const trimmedName = name.trim()
  // A Balanced user has no goal weight to validate.
  const targetOk = !liftFocused || (Number.isFinite(targetVal) && targetVal > 0)
  const valid =
    trimmedName.length > 0 &&
    Number.isFinite(bwVal) &&
    bwVal > 0 &&
    targetOk
  const changed =
    profile != null &&
    (trimmedName !== profile.name ||
      bwVal !== profile.bw ||
      (liftFocused && targetVal !== profile.target) ||
      weighInDaily !== (profile.weighInDaily === true))

  async function handleSave() {
    if (!profile || !valid || saving) return
    setSaving(true)
    setError(null)
    const updated = await saveProfile({
      name: trimmedName,
      bw: bwVal,
      trainingMode: getTrainingMode(profile),
      mainLift: profile.mainLift,
      anchor: profile.anchor,
      target: liftFocused ? targetVal : profile.target,
      weighInDaily,
      goalBw: profile.goalBw,
    })
    setSaving(false)
    if (!updated) {
      setError("Couldn't save. Check your connection and try again.")
      return
    }
    seedForm(updated)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function handleDelete() {
    if (deleting) return
    setDeleting(true)
    try {
      await fetch("/api/profile", { method: "DELETE" })
    } catch {
      // best-effort — still wipe local and sign out
    }
    wipeLocalUserData()
    signOut({ callbackUrl: "/welcome" })
  }

  if (!profile) {
    return (
      <main className="mx-auto w-full max-w-[393px] px-4 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(4rem+env(safe-area-inset-bottom))]">
        <div className="h-8 w-32 bg-surface-4 rounded animate-pulse mb-6" />
        <div className="h-40 w-full bg-surface-2 rounded-xl animate-pulse mb-4" />
        <div className="h-40 w-full bg-surface-2 rounded-xl animate-pulse" />
      </main>
    )
  }

  const bestE1RM = getBestE1RM(sessions)
  const bestWeight = getBestWeight(sessions)
  // With check-ins on, the weight log is where bodyweight lives: the same number the
  // chip on Home shows, rather than a second field here that drifts away from it.
  const weighIn = profile.weighInDaily ? latestEntry(weights) : null
  const latestBW = weighIn?.kg ?? getLatestBW(sessions)

  return (
    <main className="mx-auto w-full max-w-[393px] px-4 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(4rem+env(safe-area-inset-bottom))]">
      {/* Header */}
      <header className="flex items-center gap-2 mb-6">
        <BackButton href="/" label="Back to home" />
        <h1 className="text-2xl font-semibold text-ink tracking-tight">Profile</h1>
      </header>

      {/* My card */}
      <Link
        href="/me"
        className="flex items-center justify-between mb-4 px-4 py-4 rounded-xl bg-surface-2 border border-line active:opacity-70 transition-opacity"
      >
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-6 mb-1">
            My card
          </p>
          <p className="text-sm text-ink">See yourself the way your gymbros do</p>
        </div>
        <span className="text-brand text-sm font-semibold shrink-0 ml-3">View →</span>
      </Link>

      {/* Personal */}
      <section className="mb-4 px-4 py-4 rounded-xl bg-surface-2 border border-line">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-6 mb-4">
          Personal
        </p>

        <label className="block text-sm text-ink-5 mb-1.5">Name</label>
        <input
          value={name}
          onChange={(e) => edit({ name: e.target.value })}
          placeholder="Saif"
          className="w-full text-lg font-semibold text-ink border-b-2 border-line focus:border-brand-line outline-none bg-transparent pb-2 mb-5"
        />

        {weighIn ? (
          <div className="flex items-end justify-between">
            <div>
              <p className="text-sm text-ink-5 mb-1.5">Bodyweight</p>
              <p className="text-lg font-semibold text-ink tabular-nums">
                {weighIn.kg.toFixed(1)}
                <span className="text-base font-normal text-ink-5 ml-1.5">kg</span>
              </p>
              <p className="text-xs text-ink-5 mt-0.5">from your {formatDay(weighIn.date)} check-in</p>
            </div>
            <Link href="/weight" className="text-sm font-semibold text-brand hover:underline">
              Update →
            </Link>
          </div>
        ) : (
          <>
          <label className="block text-sm text-ink-5 mb-1.5">Bodyweight</label>
          <div className="flex items-baseline gap-2 border-b-2 border-line focus-within:border-brand-line pb-2">
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={bw}
              onChange={(e) => edit({ bw: e.target.value })}
              placeholder="60"
              className="flex-1 text-lg font-semibold text-ink outline-none bg-transparent"
            />
            <span className="text-base text-ink-6">kg</span>
          </div>
          </>
        )}
      </section>

      {/* Goal */}
      <section className="mb-4 px-4 py-4 rounded-xl bg-surface-2 border border-line">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-6 mb-4">
          Goal
        </p>

        <div className={`flex items-center justify-between ${liftFocused ? "mb-5" : ""}`}>
          <span className="text-sm text-ink-5">Training focus</span>
          <Link href="/exercises" className="text-sm font-semibold text-brand hover:underline">
            {TRAINING_MODE_LABEL[getTrainingMode(profile)]} · change
          </Link>
        </div>

        {liftFocused && (
        <>
        <label className="block text-sm text-ink-5 mb-1.5">Target</label>
        <div className="flex items-baseline gap-2 border-b-2 border-line focus-within:border-brand-line pb-2 mb-5">
          <input
            type="number"
            inputMode="decimal"
            step="2.5"
            value={target}
            onChange={(e) => edit({ target: e.target.value })}
            placeholder="140"
            className="flex-1 text-lg font-semibold text-ink outline-none bg-transparent"
          />
          <span className="text-base text-ink-6">kg</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-5">Main lift</span>
          <span className="text-sm font-semibold text-ink">
            {getMainLiftLabel(profile)}
          </span>
        </div>
        </>
        )}
      </section>

      {/* Weight check-in */}
      <section className="mb-4 px-4 py-4 rounded-xl bg-surface-2 border border-line">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-6 mb-4">
          Weight check-in
        </p>

        <div className="flex items-center justify-between">
          <div className="flex-1 pr-3">
            <p className="text-sm text-ink">Weekly check-in</p>
            <p className="text-xs text-ink-6 mt-0.5">
              we ask once a week; log any other day with the +. turning this off keeps your history.
            </p>
          </div>
          <button
            role="switch"
            aria-checked={weighInDaily}
            aria-label="Weekly weight check-in"
            onClick={() => edit((f) => ({ weighInDaily: !f.weighInDaily }))}
            className={`relative w-11 h-6 shrink-0 rounded-full transition-colors ${
              weighInDaily ? "bg-brand-fill" : "bg-surface-5"
            }`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
                weighInDaily ? "left-[22px]" : "left-0.5"
              }`}
            />
          </button>
        </div>

        {profile.weighInDaily && (
          <Link
            href="/weight"
            className="block mt-4 text-sm font-semibold text-brand hover:underline"
          >
            View weight trend →
          </Link>
        )}
      </section>

      {/* Stats (read-only) */}
      <section className="mb-4 px-4 py-4 rounded-xl bg-surface-2 border border-line">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-6 mb-4">
          Stats
        </p>
        {liftFocused && (
          <ProgressBar current={bestE1RM} target={targetVal > 0 ? targetVal : (profile.target ?? 0)} />
        )}
        <div className={`grid grid-cols-3 gap-2 ${liftFocused ? "-mt-2" : ""}`}>
          {liftFocused ? (
            <>
              <div>
                <p className="text-lg font-semibold text-ink">{bestE1RM != null ? `${bestE1RM}` : "—"}</p>
                <p className="text-xs text-ink-6">current e1RM</p>
              </div>
              <div>
                <p className="text-lg font-semibold text-ink">{bestWeight != null ? `${bestWeight}` : "—"}</p>
                <p className="text-xs text-ink-6">best lift</p>
              </div>
            </>
          ) : (
            <div>
              <p className="text-lg font-semibold text-ink">{sessions.filter((s) => s.confirmed).length}</p>
              <p className="text-xs text-ink-6">sessions</p>
            </div>
          )}
          <div>
            <p className="text-lg font-semibold text-ink">{latestBW != null ? `${latestBW}` : profile.bw}</p>
            <p className="text-xs text-ink-6">bodyweight</p>
          </div>
        </div>
      </section>

      {/* Account */}
      <section className="mt-4 px-4 py-4 rounded-xl bg-surface-2 border border-line">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-6 mb-4">
          Account
        </p>
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-ink-5">Email</span>
          <span className="text-sm text-ink truncate ml-3">{profile.email}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-5">Member since</span>
          <span className="text-sm text-ink">{formatJoined(profile.createdAt)}</span>
        </div>
      </section>

      <button
        onClick={() => setShowDelete(true)}
        className="w-full mt-4 border border-red-200 rounded-xl py-3 text-sm font-semibold text-red-500 hover:bg-red-50 active:bg-red-100 transition-colors"
      >
        Delete account &amp; data
      </button>

      {/* Save: pinned to the bottom the moment something is edited, wherever on the page that was */}
      {(changed || saving || saved || error) && (
        <>
          <div className="h-24" aria-hidden="true" />
          <div className="fixed bottom-0 inset-x-0 z-40 flex justify-center pointer-events-none animate-fade-up">
            <div className="pointer-events-auto w-full max-w-[393px] bg-raised/95 backdrop-blur border-t border-line px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
              {error && <p className="text-sm text-red-500 mb-2">{error}</p>}
              <button
                onClick={handleSave}
                disabled={!valid || !changed || saving}
                className="w-full bg-brand-fill text-white text-sm font-semibold rounded-xl py-3.5 hover:bg-brand-fill-2 active:bg-brand-fill-3 transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                {saving ? "Saving…" : saved ? "Saved ✓" : "Save changes"}
              </button>
            </div>
          </div>
        </>
      )}


      {showDelete && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => !deleting && setShowDelete(false)}>
          <EscapeKey onEscape={() => !deleting && setShowDelete(false)} />
          <div
            className="bg-raised w-full max-w-[393px] rounded-t-2xl px-6 pt-6 pb-10 max-h-[90dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-base font-semibold text-ink mb-1">Delete everything?</p>
            <p className="text-sm text-ink-5 mb-6">
              This permanently wipes your profile, sessions, and exercise setup, then signs you out.
              This can&apos;t be undone.
            </p>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="w-full bg-red-500 text-white text-sm font-semibold rounded-xl py-3.5 hover:bg-red-600 active:bg-red-700 transition-colors disabled:opacity-50 mb-3"
            >
              {deleting ? "Deleting…" : "Yes, delete everything"}
            </button>
            <button
              onClick={() => setShowDelete(false)}
              disabled={deleting}
              className="w-full border border-line rounded-xl py-3 text-sm font-semibold text-ink hover:bg-surface-1 active:bg-surface-2 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </main>
  )
}
