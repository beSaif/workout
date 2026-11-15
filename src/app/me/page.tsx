"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { UserProfile, UserPresence, FriendSessionSummary } from "@/lib/types"
import { FriendCardStats } from "@/lib/friendCard"
import { ProfileSocial, RoutineBundle } from "@/lib/routines"
import GymbroCard from "@/components/GymbroCard"
import ShareImageSheet from "@/components/ShareImageSheet"
import ProfileTabs, { ProfileTab } from "@/components/ProfileTabs"
import ProfileHeader, { SECONDARY_ACTION } from "@/components/ProfileHeader"
import RoutinePreview from "@/components/RoutinePreview"
import BackButton from "@/components/BackButton"

interface CardData {
  profile: UserProfile
  lastSessionSummary: FriendSessionSummary | null
  card: FriendCardStats
  social: ProfileSocial
  routine: RoutineBundle
}

/**
 * Your own card, exactly as your gymbros see it. Same component and same endpoint
 * as /friends/[email] — the API answers for the viewer when no email is given —
 * minus the reactions and jabs, which only make sense pointed at someone else.
 */
export default function MyCardPage() {
  const router = useRouter()

  const [data, setData] = useState<CardData | null>(null)
  const [presence, setPresence] = useState<UserPresence | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sharing, setSharing] = useState(false)
  const [tab, setTab] = useState<ProfileTab>("stats")
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    Promise.all([
      fetch("/api/friends/profile").then((r) => (r.ok ? r.json() : Promise.reject())),
      fetch("/api/presence")
        .then((r) => r.json())
        .then((arr: UserPresence[]) => arr)
        .catch(() => [] as UserPresence[]),
    ])
      .then(([cardData, presences]: [CardData, UserPresence[]]) => {
        setData(cardData)
        const mine = cardData.profile.email.trim().toLowerCase()
        setPresence(presences.find((p) => p.email.trim().toLowerCase() === mine) ?? null)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  // Snapshotted where it sits, at 3× so the shared PNG isn't a phone-width thumbnail.
  const capture = useCallback(async () => {
    const node = cardRef.current
    if (!node) throw new Error("no node")
    const { toBlob } = await import("html-to-image")
    return toBlob(node, {
      pixelRatio: 3,
      backgroundColor: "#ffffff",
      cacheBust: true,
    })
  }, [])

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
        <p className="text-sm text-ink-6 text-center mt-20">No card found</p>
      </main>
    )
  }

  const { profile, lastSessionSummary, card, social, routine } = data
  const fileName = `gymbro-card-${profile.email.split("@")[0]}.png`
  const isLive = presence?.inSession ?? false

  return (
    <main className="mx-auto w-full max-w-[393px] px-5 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(2rem+env(safe-area-inset-bottom))]">
      {backButton}

      <ProfileHeader profile={profile} card={card} social={social} isLive={isLive}>
        <Link href="/exercises" className={SECONDARY_ACTION}>
          Edit routine
        </Link>
        <button onClick={() => setSharing(true)} className={SECONDARY_ACTION}>
          Share card
        </button>
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
          />
          <p className="text-center text-[10px] text-ink-7 mt-3">this is what your gymbros see</p>
        </>
      ) : (
        <>
          <p className="text-xs text-ink-6 mb-4">
            {social.coach
              ? `You train under ${social.coach.name}, so this is their routine.`
              : "Anyone can see your routine and train under you."}
          </p>
          <RoutinePreview routine={routine} />
        </>
      )}

      {/* The shared image is the whole collectible, sprite and name included, which the
          stats tab leaves to the header. It is laid out off-screen at the width it
          renders on the page, purely for the snapshot. */}
      <div aria-hidden="true" className="fixed top-0 left-[-10000px] w-[353px] pointer-events-none">
        <div ref={cardRef}>
          <GymbroCard
            profile={profile}
            card={card}
            lastSessionSummary={lastSessionSummary}
            isLive={isLive}
          />
        </div>
      </div>

      {sharing && (
        <ShareImageSheet
          title="share your card"
          fileName={fileName}
          alt="Your gymbro card"
          capture={capture}
          onClose={() => setSharing(false)}
        />
      )}
    </main>
  )
}
