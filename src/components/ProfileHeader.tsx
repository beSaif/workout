"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { PersonSummary, ProfileSocial } from "@/lib/routines"
import { MainLift, MAIN_LIFT_LABEL, PublicProfile, TRAINING_MODE_LABEL } from "@/lib/types"
import { FriendCardStats } from "@/lib/friendCard"
import { isLiftFocused } from "@/lib/trainingMode"
import { RARITY, LIFT_PILL, BALANCED_PILL } from "@/lib/cardTheme"
import PixelAvatar from "@/components/PixelAvatar"
import EscapeKey from "@/components/EscapeKey"

type Kind = "gymbros" | "athletes"

/**
 * Who a profile belongs to, all in one place above the tabs: sprite, name, lift and
 * rarity, then the counts beside them, then who they train under, then whatever the
 * viewer can do about it (`children`). It never changes with the tab below, so you
 * always know whose stats or routine you are reading.
 */
export default function ProfileHeader({
  profile,
  card,
  social,
  isLive,
  children,
}: {
  profile: PublicProfile
  card: FriendCardStats
  social: ProfileSocial
  isLive: boolean
  children?: React.ReactNode
}) {
  const [open, setOpen] = useState<Kind | null>(null)
  const rarity = RARITY[card.rarity]
  const lift: MainLift | undefined = isLiftFocused(profile) ? profile.mainLift : undefined

  return (
    <header className="mb-4">
      <div className="flex items-center gap-4">
        <div
          className="relative shrink-0 w-[84px] h-[84px] rounded-2xl flex items-center justify-center overflow-hidden"
          style={{ backgroundColor: rarity.bg }}
        >
          {rarity.holo && (
            <span
              className="pointer-events-none absolute -inset-y-6 -left-1/3 w-1/3 animate-holo-sweep"
              style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.75), transparent)" }}
              aria-hidden="true"
            />
          )}
          <PixelAvatar seed={profile.email} colour={rarity.bar} className="w-14 h-14" />
          {isLive && (
            <span
              className="absolute top-1.5 right-1.5 w-3 h-3 rounded-full bg-green-500 border-2 border-surface animate-pulse"
              aria-label="In session"
            />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold text-ink tracking-tight truncate">{profile.name}</h1>
          <div className="flex items-center gap-1.5 mt-1">
            <span
              className={`text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded-full ${
                lift ? LIFT_PILL[lift] : BALANCED_PILL
              }`}
            >
              {lift ? MAIN_LIFT_LABEL[lift] : TRAINING_MODE_LABEL.balanced}
            </span>
            <span
              className="text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded-full"
              style={{ backgroundColor: rarity.bg, color: rarity.ink }}
            >
              {rarity.label}
            </span>
            {isLive && (
              <span className="text-[10px] font-semibold uppercase tracking-widest text-green-600">
                In session
              </span>
            )}
          </div>

          <div className="flex items-start gap-5 mt-3">
            <Count value={card.level} label="session" />
            {/* Who they are is private: only the owner can open the lists behind the counts. */}
            <Count
              value={social.gymbroCount}
              label="gymbro"
              onClick={social.isSelf ? () => setOpen("gymbros") : undefined}
            />
            <Count
              value={social.athleteCount}
              label="athlete"
              onClick={social.isSelf ? () => setOpen("athletes") : undefined}
            />
          </div>
        </div>
      </div>

      {social.coach && (
        <p className="text-xs text-ink-5 mt-3">
          Trains under{" "}
          <Link
            href={`/friends/${encodeURIComponent(social.coach.email)}`}
            className="font-semibold text-brand hover:underline"
          >
            {social.coach.name}
          </Link>
        </p>
      )}

      {children && <div className="flex gap-2 mt-4">{children}</div>}

      {open && <PeopleSheet email={profile.email} kind={open} onClose={() => setOpen(null)} />}
    </header>
  )
}

function Count({ value, label, onClick }: { value: number; label: string; onClick?: () => void }) {
  const body = (
    <>
      <span className="block text-base font-semibold text-ink tabular-nums leading-tight">{value}</span>
      <span className="block text-[11px] text-ink-5">
        {label}
        {value !== 1 ? "s" : ""}
      </span>
    </>
  )
  return onClick ? (
    <button onClick={onClick} className="text-left active:opacity-60 transition-opacity">
      {body}
    </button>
  ) : (
    <div>{body}</div>
  )
}

/** Header button styles: one filled primary, the rest outlined. */
export const PRIMARY_ACTION =
  "flex-1 h-10 rounded-xl bg-brand-fill text-white text-sm font-semibold hover:bg-brand-fill-2 active:scale-[0.98] transition disabled:opacity-60 flex items-center justify-center"
export const SECONDARY_ACTION =
  "flex-1 h-10 rounded-xl border border-line bg-surface text-sm font-semibold text-ink hover:bg-surface-1 active:scale-[0.98] transition disabled:opacity-50 flex items-center justify-center"

function PeopleSheet({ email, kind, onClose }: { email: string; kind: Kind; onClose: () => void }) {
  const [people, setPeople] = useState<PersonSummary[] | null>(null)

  useEffect(() => {
    fetch(`/api/users/people?email=${encodeURIComponent(email)}&kind=${kind}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setPeople(Array.isArray(data) ? data : []))
      .catch(() => setPeople([]))
  }, [email, kind])

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <EscapeKey onEscape={onClose} />
      <div
        className="bg-raised w-full max-w-[393px] rounded-t-2xl px-5 pt-5 pb-[calc(2rem+env(safe-area-inset-bottom))] max-h-[70vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-6 mb-3">
          {kind === "gymbros" ? "Gymbros" : "Athletes"}
        </p>
        {people === null ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 bg-surface-2 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : people.length === 0 ? (
          <p className="text-sm text-ink-6 py-6 text-center">
            {kind === "gymbros" ? "No gymbros yet" : "Nobody trains under them yet"}
          </p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {people.map((p) => (
              <li key={p.email}>
                <PersonRow person={p} onClick={onClose} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/** One person in a list: name and what they train, linking to their profile. */
export function PersonRow({ person, onClick }: { person: PersonSummary; onClick?: () => void }) {
  const badge =
    person.trainingMode === "balanced" || !person.mainLift
      ? TRAINING_MODE_LABEL.balanced
      : MAIN_LIFT_LABEL[person.mainLift]
  return (
    <Link
      href={`/friends/${encodeURIComponent(person.email)}`}
      onClick={onClick}
      className="flex items-center justify-between gap-3 py-3 active:opacity-70 transition-opacity"
    >
      <span className="text-sm font-semibold text-ink truncate">{person.name}</span>
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full bg-surface-2 text-ink-4">
        {badge}
      </span>
    </Link>
  )
}
