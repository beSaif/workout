"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { PublicProfile, UserPresence, Session, FriendSessionSummary } from "@/lib/types"
import { FriendCardStats, FriendPR } from "@/lib/friendCard"
import { ProfileSocial, RoutineBundle } from "@/lib/routines"
import { trainUnder, stopTrainingUnderCoach, loadCoach } from "@/lib/storage"
import GymbroCard, { prKey } from "@/components/GymbroCard"
import MessageComposer from "@/components/MessageComposer"
import ProfileTabs, { ProfileTab } from "@/components/ProfileTabs"
import ProfileHeader, { PRIMARY_ACTION, SECONDARY_ACTION } from "@/components/ProfileHeader"
import RoutinePreview from "@/components/RoutinePreview"
import BackButton from "@/components/BackButton"
import { useConfirm } from "@/components/ConfirmSheet"
import EscapeKey from "@/components/EscapeKey"

interface ProfileData {
  /** The full profile for a gymbro; only the card's fields for anyone else. */
  profile: PublicProfile
  lastSession: Session | null
  /** Resolved server-side: the viewer cannot read the friend's days or muscle names. */
  lastSessionSummary: FriendSessionSummary | null
  card: FriendCardStats
  social: ProfileSocial
  routine: RoutineBundle
}

type Coaching = "idle" | "confirming" | "busy"

/**
 * Anyone's profile. Everyone signed in sees the card, the counts and the Routine
 * tab — and can train under them from there. Hype and messages are for
 * gymbros only.
 */
export default function FriendProfilePage() {
  const { confirm, confirmSheet } = useConfirm()
  const params = useParams()
  const router = useRouter()
  const email = decodeURIComponent(params.email as string)

  const [data, setData] = useState<ProfileData | null>(null)
  const [presence, setPresence] = useState<UserPresence | null>(null)
  const [error, setError] = useState<"notfound" | null>(null)
  const [tab, setTab] = useState<ProfileTab>("stats")
  const [coaching, setCoaching] = useState<Coaching>("idle")
  const [coachError, setCoachError] = useState<string | null>(null)
  /** Name of whoever the viewer trains under now, for the switch warning. */
  const [myCoachName, setMyCoachName] = useState<string | null>(null)
  const [requestState, setRequestState] = useState<"idle" | "sending" | "sent" | "error">("idle")
  const [loading, setLoading] = useState(true)
  const [showComposer, setShowComposer] = useState(false)
  const [reactedPRs, setReactedPRs] = useState<string[]>([])

  useEffect(() => {
    Promise.all([
      fetch(`/api/friends/profile?email=${encodeURIComponent(email)}`).then((r) =>
        r.ok ? r.json() : Promise.reject("notfound")
      ),
      fetch("/api/presence")
        .then((r) => r.json())
        .then((arr: UserPresence[]) => arr.find((p) => p.email === email) ?? null)
        .catch(() => null),
    ])
      .then(([profileData, pres]) => {
        setData(profileData)
        setPresence(pres)
      })
      .catch(() => setError("notfound"))
      .finally(() => setLoading(false))
    loadCoach().then((c) => setMyCoachName(c?.name ?? null))
  }, [email])

  async function confirmTrainUnder() {
    if (!data) return
    setCoaching("busy")
    setCoachError(null)
    const result = await trainUnder(data.profile.email)
    if (result.ok) {
      setData({
        ...data,
        social: { ...data.social, isMyCoach: true, athleteCount: data.social.athleteCount + 1 },
      })
      setMyCoachName(result.coach.name)
      setCoaching("idle")
    } else {
      setCoachError(
        result.error === "they train under you"
          ? `${data.profile.name.split(" ")[0]} already trains under you, so you can't train under them.`
          : "Couldn't switch over. Check your connection and try again."
      )
      setCoaching("confirming")
    }
  }

  async function stopTraining() {
    if (!data) return
    const yes = await confirm({
      title: "Stop training under them?",
      body: "Their routine, as it is now, stays yours to edit.",
      confirmLabel: "Stop training under them",
    })
    if (!yes) return
    setCoaching("busy")
    const ok = await stopTrainingUnderCoach()
    if (ok) {
      setData({
        ...data,
        social: { ...data.social, isMyCoach: false, athleteCount: Math.max(0, data.social.athleteCount - 1) },
      })
      setMyCoachName(null)
    }
    setCoaching("idle")
  }

  async function sendFriendRequest() {
    if (!data) return
    setRequestState("sending")
    try {
      const res = await fetch("/api/friends/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetEmail: data.profile.email }),
      })
      const body = res.ok ? await res.json().catch(() => null) : null
      if (body?.accepted) {
        // They had already asked: asking back made it mutual.
        setData({ ...data, social: { ...data.social, isFriend: true, gymbroCount: data.social.gymbroCount + 1 } })
        setRequestState("idle")
        return
      }
      setRequestState(res.ok ? "sent" : "error")
    } catch {
      setRequestState("error")
    }
  }

  /** Reactions are ordinary gymbro messages; there is no separate channel. */
  function sendMessage(text: string) {
    return fetch("/api/messages/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toEmail: email, text }),
    }).catch(() => {})
  }

  function reactToPR(pr: FriendPR) {
    if (reactedPRs.includes(prKey(pr))) return
    setReactedPRs((prev) => [...prev, prKey(pr)])
    sendMessage(`🔥 ${pr.exercise} ${pr.kg}kg × ${pr.reps} — nasty`)
  }

  const backButton = (
    <BackButton onClick={() => router.back()} label="Go back" className="mb-4" />
  )

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-[393px] px-5 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-8">
        {backButton}
        <div className="rounded-2xl bg-surface-2 animate-pulse h-[520px]" />
      </main>
    )
  }

  if (error || !data) {
    return (
      <main className="mx-auto w-full max-w-[393px] px-5 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-8">
        {backButton}
        <p className="text-sm text-ink-6 text-center mt-20">No profile found</p>
      </main>
    )
  }

  const { profile, lastSessionSummary, card, social, routine } = data
  const isLive = presence?.inSession ?? false
  const firstName = profile.name.split(" ")[0]
  // Hype and messages are between gymbros; your own profile has none either.
  const canMessage = social.isFriend && !social.isSelf

  // What the viewer can do sits in the header, so it is there whichever tab is open.
  // The friendship is the primary action: message a gymbro, or ask a stranger to
  // become one. Training under them rewrites your routine, so it stays secondary.
  const requested = social.requestPending || requestState === "sent"
  const actions = social.isSelf ? null : (
    <>
      {canMessage ? (
        <button onClick={() => setShowComposer(true)} className={PRIMARY_ACTION}>
          Message
        </button>
      ) : (
        <button
          onClick={sendFriendRequest}
          disabled={requested || requestState === "sending"}
          className={PRIMARY_ACTION}
        >
          {requested
            ? "Requested"
            : requestState === "sending"
              ? "…"
              : requestState === "error"
                ? "Try again"
                : "Add gymbro"}
        </button>
      )}
      {social.isMyCoach ? (
        <button onClick={stopTraining} disabled={coaching === "busy"} className={SECONDARY_ACTION}>
          Training under ✓
        </button>
      ) : (
        <button
          onClick={() => { setCoachError(null); setCoaching("confirming") }}
          className={SECONDARY_ACTION}
        >
          Train under {firstName}
        </button>
      )}
    </>
  )

  return (
    <main className="mx-auto w-full max-w-[393px] px-5 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(2rem+env(safe-area-inset-bottom))]">
      {confirmSheet}
      {backButton}

      <ProfileHeader profile={profile} card={card} social={social} isLive={isLive}>
        {actions}
      </ProfileHeader>

      <ProfileTabs tab={tab} onChange={setTab} />

      {tab === "stats" ? (
        <>
          <GymbroCard
            variant="stats"
            profile={profile}
            card={card}
            lastSessionSummary={lastSessionSummary}
            isLive={isLive}
            reactedPRs={reactedPRs}
            onReactPR={canMessage ? reactToPR : undefined}
          />
          {canMessage && card.records.length > 0 && (
            <p className="text-center text-[10px] text-ink-7 mt-3">tap a record to hype it</p>
          )}
        </>
      ) : (
        <>
          {social.isMyCoach && (
            <p className="text-xs text-ink-6 mb-4">
              You train under {firstName}, so this is your routine too. When they change it,
              yours changes with it.
            </p>
          )}
          <RoutinePreview routine={routine} />
        </>
      )}

      {/* Train-under confirmation */}
      {coaching !== "idle" && !social.isMyCoach && (
        <div
          role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
          onClick={() => coaching !== "busy" && setCoaching("idle")}
        >
          <EscapeKey onEscape={() => coaching !== "busy" && setCoaching("idle")} />
          <div
            className="bg-raised w-full max-w-[393px] rounded-t-2xl px-6 pt-6 pb-[calc(2.5rem+env(safe-area-inset-bottom))] max-h-[90dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-base font-semibold text-ink mb-3">Train under {firstName}?</p>
            {/* The cost comes first and loud: this overwrites the viewer's own routine. */}
            <div role="alert" className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3.5 mb-3">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5 text-amber-600" aria-hidden="true">
                <path d="M10 2.5 18 17H2L10 2.5Z" />
                <line x1="10" y1="8" x2="10" y2="11.5" />
                <circle cx="10" cy="14.2" r="0.6" fill="currentColor" />
              </svg>
              <div>
                <p className="text-sm font-semibold text-amber-900">Your routine will be replaced</p>
                <ul className="mt-1.5 space-y-1 text-[13px] text-amber-900/80 list-disc pl-4">
                  <li>Your training days and muscle groups become {firstName}&apos;s.</li>
                  <li>They stay in sync whenever {firstName} changes theirs.</li>
                  <li>You can&apos;t edit them while you train under {firstName}.</li>
                  {myCoachName && (
                    <li>
                      You stop training under <span className="font-semibold">{myCoachName}</span>.
                    </li>
                  )}
                </ul>
              </div>
            </div>
            <p className="text-xs text-ink-5 mb-6">
              Your logged sessions, main lift, targets and cardio stay yours. Stop any time
              and keep the routine.
            </p>
            {coachError && <p className="text-xs text-red-500 mb-3">{coachError}</p>}
            <button
              onClick={confirmTrainUnder}
              disabled={coaching === "busy"}
              className="w-full bg-brand-fill text-white text-sm font-semibold rounded-xl py-3.5 hover:bg-brand-fill-2 transition-colors mb-3 disabled:opacity-60"
            >
              {coaching === "busy" ? "Switching…" : `Train under ${firstName}`}
            </button>
            <button
              onClick={() => setCoaching("idle")}
              disabled={coaching === "busy"}
              className="w-full border border-line rounded-xl py-3 text-sm font-semibold text-ink hover:bg-surface-1 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {showComposer && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setShowComposer(false)}>
          <EscapeKey onEscape={() => setShowComposer(false)} />
          <div
            className="w-full max-w-md rounded-t-2xl bg-zinc-900 px-5 pt-5 pb-8 max-h-[90dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <MessageComposer
              recipientLabel={firstName}
              toEmail={profile.email}
              onSent={() => setShowComposer(false)}
              onClose={() => setShowComposer(false)}
            />
          </div>
        </div>
      )}
    </main>
  )
}
