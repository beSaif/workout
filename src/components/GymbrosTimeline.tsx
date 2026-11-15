"use client"

import Link from "next/link"
import { GymbroMessage, UserPresence } from "@/lib/types"
import { relativeDate } from "@/lib/time"
import PixelAvatar from "@/components/PixelAvatar"

/** A gymbro who has not trained for this many days fades back in the rail. */
const QUIET_AFTER_DAYS = 7

type Status = "live" | "today" | "recent" | "quiet"

/** Whole calendar days since `dateStr`, or Infinity for someone who never trained. */
function daysSince(dateStr: string | null): number {
  if (!dateStr) return Infinity
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const d = new Date(dateStr)
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return Math.max(0, Math.round((today - day) / 86_400_000))
}

function minutesIn(startedAt: string | null | undefined): number | null {
  if (!startedAt) return null
  const mins = Math.floor((Date.now() - new Date(startedAt).getTime()) / 60_000)
  return mins >= 0 ? mins : null
}

/** The ring is the status: green while lifting, navy once trained today, hairline otherwise. */
const RING: Record<Status, string> = {
  live: "ring-2 ring-green-500 ring-offset-2 ring-offset-white",
  today: "ring-2 ring-brand-line ring-offset-2 ring-offset-white",
  recent: "ring-1 ring-line-strong ring-offset-2 ring-offset-white",
  quiet: "ring-1 ring-line-strong ring-offset-2 ring-offset-white opacity-45",
}

interface Entry {
  key: string
  presence: UserPresence
  isMe: boolean
  status: Status
  days: number
  timeLabel: string
  msgCount: number
}

interface Props {
  friendPresences: UserPresence[]
  currentUserEmail: string
  currentUserName: string
  currentUserInSession: boolean
  currentUserLastSessionDate: string | null
  friendLastActive?: Record<string, string>
  messagesByFriend?: Record<string, GymbroMessage[]>
  onAvatarClick?: (presence: UserPresence) => void
}

/**
 * The gymbros as a rail of faces. Order carries recency and the ring carries
 * status, so the row needs no axis and holds any number of people: it scrolls.
 */
export default function GymbrosTimeline({
  friendPresences,
  currentUserEmail,
  currentUserName,
  currentUserInSession,
  currentUserLastSessionDate,
  friendLastActive,
  messagesByFriend,
  onAvatarClick,
}: Props) {
  function toEntry(presence: UserPresence, isMe: boolean, lastLiftDate: string | null): Entry {
    const key = presence.email.trim().toLowerCase()
    const days = daysSince(lastLiftDate)
    const live = presence.inSession
    const status: Status = live
      ? "live"
      : days === 0
        ? "today"
        : days < QUIET_AFTER_DAYS
          ? "recent"
          : "quiet"
    const mins = live ? minutesIn(presence.startedAt) : null
    const timeLabel = live
      ? mins != null && mins > 0
        ? `${mins} min in`
        : "lifting now"
      : lastLiftDate
        ? relativeDate(lastLiftDate)
        : "never"
    return {
      key,
      presence,
      isMe,
      status,
      days,
      timeLabel,
      msgCount: isMe ? 0 : messagesByFriend?.[key]?.length ?? 0,
    }
  }

  const me = toEntry(
    { email: currentUserEmail, name: currentUserName, inSession: currentUserInSession, startedAt: null },
    true,
    currentUserLastSessionDate
  )

  // Unread messages first, then whoever is lifting, then most recent session.
  const friends = friendPresences
    .filter((p) => p.email !== currentUserEmail)
    .map((p) => toEntry(p, false, friendLastActive?.[p.email.trim().toLowerCase()] ?? null))
    .sort(
      (a, b) =>
        Number(b.msgCount > 0) - Number(a.msgCount > 0) ||
        Number(b.status === "live") - Number(a.status === "live") ||
        a.days - b.days ||
        a.presence.name.localeCompare(b.presence.name)
    )

  const itemClass =
    "shrink-0 w-[58px] snap-start flex flex-col items-center text-center active:opacity-70 transition-opacity"

  return (
    <div className="mb-4">
      <p className="text-[10px] uppercase tracking-widest font-medium text-ink-6 mb-2">gymbros</p>

      {/* Bleeds to the screen edge so a face slides off the side, not into a margin. */}
      <ul
        className="flex gap-3.5 -mx-4 px-4 pt-1.5 pb-0.5 overflow-x-auto snap-x snap-proximity scroll-px-4
                   [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {[me, ...friends].map((e) => {
          const name = e.isMe ? "me" : e.presence.name.split(" ")[0]
          const label = e.isMe
            ? `Your card, ${e.timeLabel}`
            : `${e.presence.name}, ${e.timeLabel}${e.msgCount > 0 ? `, ${e.msgCount} new message${e.msgCount === 1 ? "" : "s"}` : ""}`

          const inner = (
            <>
              <span className="relative">
                <span
                  className={`w-[50px] h-[50px] rounded-full bg-[#eef1f5] flex items-center justify-center ${RING[e.status]}`}
                >
                  <PixelAvatar seed={e.presence.email} colour="#1e3a5f" className="w-[30px] h-[30px]" />
                </span>
                {e.msgCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-0.5 bg-red-500 rounded-full text-white text-[10px] font-bold flex items-center justify-center border-2 border-surface leading-none">
                    {e.msgCount > 9 ? "9+" : e.msgCount}
                  </span>
                )}
              </span>
              <span className="mt-2 max-w-full truncate text-[11px] font-semibold text-ink leading-tight">
                {name}
              </span>
              <span
                className={`text-[10px] leading-tight whitespace-nowrap ${
                  e.status === "live" ? "font-semibold text-green-700" : "text-ink-6"
                }`}
              >
                {e.timeLabel}
              </span>
            </>
          )

          return (
            <li key={e.key} className="shrink-0">
              {e.isMe ? (
                // Your own face opens your card, not a friend page: the friend route
                // is keyed by a gymbro you have, and you are not your own gymbro.
                <Link href="/me" className={itemClass} aria-label={label}>
                  {inner}
                </Link>
              ) : e.msgCount > 0 ? (
                <button onClick={() => onAvatarClick?.(e.presence)} className={itemClass} aria-label={label}>
                  {inner}
                </button>
              ) : (
                <Link
                  href={`/friends/${encodeURIComponent(e.presence.email)}`}
                  className={itemClass}
                  aria-label={label}
                >
                  {inner}
                </Link>
              )}
            </li>
          )
        })}

        <li className="shrink-0">
          <Link href="/gymbros" className={itemClass} aria-label="Add a gymbro">
            <span className="w-[50px] h-[50px] rounded-full border-[1.5px] border-dashed border-line-strong flex items-center justify-center text-ink-6 text-xl font-light">
              +
            </span>
            <span className="mt-2 text-[11px] font-medium text-ink-6 leading-tight">add</span>
          </Link>
        </li>
      </ul>
    </div>
  )
}
