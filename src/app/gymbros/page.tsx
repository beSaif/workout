"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import { UserProfile, MainLift, MAIN_LIFT_LABEL, TRAINING_MODE_LABEL, UserPresence, FriendRequest, GymbroMessage } from "@/lib/types"
import { isLiftFocused } from "@/lib/trainingMode"
import { relativeDate } from "@/lib/time"
import { PersonSummary } from "@/lib/routines"
import { useOnboardingGuard } from "@/lib/useOnboardingGuard"
import { PersonRow } from "@/components/ProfileHeader"
import BackButton from "@/components/BackButton"
import EscapeKey from "@/components/EscapeKey"

function initials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
}

function LiftBadge({ profile }: { profile: UserProfile }) {
  const colours: Record<MainLift, string> = {
    bench: "bg-brand-tint text-brand",
    squat: "bg-brand-tint text-brand",
    deadlift: "bg-good-tint text-good",
  }
  // A Balanced gymbro has no main lift; badge their mode instead.
  const lift = isLiftFocused(profile) ? profile.mainLift : undefined
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full ${lift ? colours[lift] : "bg-surface-2 text-ink-4"}`}>
      {lift ? MAIN_LIFT_LABEL[lift] : TRAINING_MODE_LABEL.balanced}
    </span>
  )
}

/** /api/friends attaches the friend's most recent confirmed session date. */
type Gymbro = UserProfile & { lastSessionDate?: string | null }

type AddState = "idle" | "sending" | "sent" | "accepted" | "not_found" | "already_friends" | "already_pending" | "self" | "error"

export default function GymBrosPage() {
  useOnboardingGuard()
  const [friends, setFriends] = useState<Gymbro[]>([])
  const [presences, setPresences] = useState<UserPresence[]>([])
  const [requests, setRequests] = useState<FriendRequest[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [requestsOpen, setRequestsOpen] = useState(false)
  const [addState, setAddState] = useState<AddState>("idle")
  const [loading, setLoading] = useState(true)
  const [removingEmail, setRemovingEmail] = useState<string | null>(null)
  const [pendingRemove, setPendingRemove] = useState<Gymbro | null>(null)
  const [messages, setMessages] = useState<GymbroMessage[]>([])
  const addInputRef = useRef<HTMLInputElement>(null)
  // One timer at a time: an older request's reset must not wipe a newer result.
  const addFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<PersonSummary[] | null>(null)

  // Anyone can be found by name, gymbro or not: their profile is where you add them
  // or train under them.
  useEffect(() => {
    const q = query.trim()
    // An email is an invitation, not a name to look up.
    if (q.length < 2 || q.includes("@")) return
    const timer = setTimeout(() => {
      fetch(`/api/users/search?q=${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => setResults(Array.isArray(data) ? data : []))
        .catch(() => setResults([]))
    }, 250)
    return () => clearTimeout(timer)
  }, [query])
  // One field does both jobs: a name searches, an email address adds.
  const isEmail = query.includes("@")
  const shownResults = !isEmail && query.trim().length >= 2 ? results : null

  function fetchAll() {
    Promise.all([
      fetch("/api/friends").then((r) => r.json()),
      fetch("/api/friends/requests").then((r) => r.json()),
      fetch("/api/messages").then((r) => r.json()),
    ])
      .then(([f, req, msgs]: [Gymbro[], { requests: FriendRequest[]; count: number }, GymbroMessage[]]) => {
        setFriends(Array.isArray(f) ? f : [])
        setRequests(req?.requests ?? [])
        setPendingCount(req?.count ?? 0)
        setMessages(Array.isArray(msgs) ? msgs : [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  async function dismissMessages() {
    setMessages([])
    await fetch("/api/messages", { method: "DELETE" }).catch(() => {})
  }

  function fetchPresence() {
    fetch("/api/presence")
      .then((r) => r.json())
      .then((data: UserPresence[]) => { if (Array.isArray(data)) setPresences(data) })
      .catch(() => {})
  }

  useEffect(() => {
    fetchAll()
    fetchPresence()

    const presenceInterval = setInterval(fetchPresence, 15000)
    const friendsInterval = setInterval(fetchAll, 30000)
    return () => {
      clearInterval(presenceInterval)
      clearInterval(friendsInterval)
    }
  }, [])

  function getPresence(email: string): UserPresence | undefined {
    return presences.find((p) => p.email === email)
  }

  async function handleAddFriend(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    const email = query.trim().toLowerCase()
    if (!email || !isEmail) return
    if (addFeedbackTimer.current) clearTimeout(addFeedbackTimer.current)
    setAddState("sending")
    try {
      const res = await fetch("/api/friends/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetEmail: email }),
      })
      if (res.ok) {
        // They had already asked us, so the server made it mutual on the spot.
        const body = await res.json().catch(() => null)
        setAddState(body?.accepted ? "accepted" : "sent")
        setQuery("")
        if (body?.accepted) fetchAll()
      } else {
        const body = await res.json()
        if (body.error === "user not found") setAddState("not_found")
        else if (body.error === "already friends") setAddState("already_friends")
        else if (body.error === "request already sent") setAddState("already_pending")
        else if (body.error === "cannot add yourself") setAddState("self")
        else setAddState("error")
      }
    } catch {
      setAddState("error")
    }
    addFeedbackTimer.current = setTimeout(() => setAddState("idle"), 3000)
  }

  async function handleAccept(requesterEmail: string) {
    await fetch("/api/friends/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requesterEmail }),
    })
    fetchAll()
  }

  async function handleReject(requesterEmail: string) {
    await fetch("/api/friends/reject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requesterEmail }),
    })
    fetchAll()
  }

  async function handleRemoveFriend(friendEmail: string) {
    setPendingRemove(null)
    setRemovingEmail(friendEmail)
    await fetch("/api/friends", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ friendEmail }),
    })
    setRemovingEmail(null)
    fetchAll()
  }

  const addFeedback: Record<AddState, string> = {
    idle: "",
    sending: "",
    sent: "Request sent",
    accepted: "They'd already asked — you're gymbros now",
    not_found: "No user with that email",
    already_friends: "Already friends",
    already_pending: "Request already sent",
    self: "That's you",
    error: "Something went wrong",
  }

  return (
    <main className="mx-auto w-full max-w-[393px] px-4 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-6">
      <header className="mb-6">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <BackButton href="/" label="Back to home" />
            <h1 className="text-2xl font-semibold text-ink tracking-tight">Gymbros</h1>
          </div>
          <button
            onClick={() => setRequestsOpen((o) => !o)}
            className="relative p-1.5 text-ink-4 hover:text-ink transition-colors"
            aria-label="Friend requests"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10 2a5 5 0 0 1 5 5c0 1.5-.5 2.8-1.4 3.8L17 17H3l3.4-6.2A5 5 0 0 1 5 7a5 5 0 0 1 5-5z" />
              <line x1="10" y1="17" x2="10" y2="19" />
            </svg>
            {pendingCount > 0 && (
              <span className="absolute top-0 right-0 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[15px] h-[15px] flex items-center justify-center px-0.5 leading-none">
                {pendingCount > 9 ? "9+" : pendingCount}
              </span>
            )}
          </button>
        </div>
        {!loading && (
          <p className="text-sm text-ink-5 ml-[2.375rem]">
            {friends.length} gymbro{friends.length !== 1 ? "s" : ""}
          </p>
        )}
      </header>

      {/* Incoming messages */}
      {messages.length > 0 && (
        <div className="mb-5 bg-zinc-900 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
              🔥 {messages.length} message{messages.length !== 1 ? "s" : ""}
            </p>
            <button
              onClick={dismissMessages}
              className="text-zinc-500 hover:text-zinc-300 transition-colors text-lg leading-none"
              aria-label="Dismiss messages"
            >
              ✕
            </button>
          </div>
          <ul className="divide-y divide-zinc-800">
            {messages.map((msg) => (
              <li key={msg.id} className="px-4 py-3">
                <p className="text-xs text-zinc-400 mb-0.5 font-medium">{msg.fromName}</p>
                <p className="text-sm text-white">{msg.text}</p>
              </li>
            ))}
          </ul>
          <button
            onClick={dismissMessages}
            className="w-full py-2.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            got it 👍
          </button>
        </div>
      )}

      {/* Requests panel */}
      {requestsOpen && (
        <div className="mb-5 bg-surface border border-line-soft rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-line-soft">
            <p className="text-xs font-semibold uppercase tracking-widest text-ink-6">Pending requests</p>
          </div>
          {requests.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-6">No pending requests</p>
          ) : (
            <ul className="divide-y divide-line-soft">
              {requests.map((req) => (
                <li key={req.email} className="flex items-center justify-between px-4 py-3 gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink truncate">{req.name}</p>
                    <p className="text-[11px] text-ink-6 truncate">{req.email}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => handleAccept(req.email)}
                      className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-brand-fill text-white hover:bg-brand-fill-2 transition-colors"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => handleReject(req.email)}
                      className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-surface-2 text-ink-4 hover:bg-surface-3 transition-colors"
                    >
                      Reject
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Find or add people: a name searches, an email sends a request */}
      <form onSubmit={handleAddFriend} className="mb-5">
        <div className="flex gap-2">
          <input
            ref={addInputRef}
            type="text"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            enterKeyHint={isEmail ? "send" : "search"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or add by email"
            aria-label="Search by name or add by email"
            className="flex-1 min-w-0 text-sm px-3 py-2.5 border border-line-strong rounded-xl bg-surface text-ink placeholder-ink-7 focus:outline-none focus:border-brand-line transition-colors"
          />
          {isEmail && (
            <button
              type="submit"
              disabled={addState === "sending" || !query.trim()}
              className="text-sm font-semibold px-4 py-2.5 rounded-xl bg-brand-fill text-white disabled:opacity-40 hover:bg-brand-fill-2 transition-colors shrink-0 animate-fade-in"
            >
              {addState === "sending" ? "…" : "Add"}
            </button>
          )}
        </div>
        {addState !== "idle" && addState !== "sending" && (
          <p className={`mt-1.5 text-[12px] ml-1 ${addState === "sent" || addState === "accepted" ? "text-green-600" : "text-red-500"}`}>
            {addFeedback[addState]}
          </p>
        )}
        {shownResults !== null && (
          <div className="mt-2 bg-surface border border-line-soft rounded-xl px-4 shadow-sm">
            {shownResults.length === 0 ? (
              <p className="py-3 text-sm text-ink-5">Nobody by that name. Know their email? Type it to add them.</p>
            ) : (
              <ul className="divide-y divide-line-soft">
                {shownResults.map((p) => (
                  <li key={p.email}>
                    <PersonRow person={p} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </form>

      {/* Friends list */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 bg-surface-4 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : friends.length === 0 ? (
        <p className="text-sm text-ink-6 text-center mt-16">No gymbros yet. Search a name or type an email above.</p>
      ) : (
        <ul className="space-y-3">
          {friends.map((bro) => {
            const presence = getPresence(bro.email)
            const isLive = presence?.inSession ?? false
            const isRemoving = removingEmail === bro.email
            return (
              <li
                key={bro.email}
                className={`bg-surface border rounded-xl px-4 py-3.5 shadow-sm transition-colors ${
                  isLive ? "border-green-300 bg-green-50/30" : "border-line-soft"
                } ${isRemoving ? "opacity-50" : ""}`}
              >
                <div className="flex items-center justify-between gap-3 mb-2.5">
                  <Link
                    href={`/friends/${encodeURIComponent(bro.email)}`}
                    className="flex items-center gap-2.5 min-w-0 active:opacity-70 transition-opacity"
                  >
                    <div className="relative shrink-0">
                      <div className="w-9 h-9 rounded-full bg-surface-3 flex items-center justify-center text-xs font-bold text-ink-4 select-none">
                        {initials(bro.name)}
                      </div>
                      {isLive && (
                        <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-surface" />
                      )}
                    </div>
                    {/* Name on its own line, badges under it: the badges used to squeeze it to "Omar …" */}
                    <span className="flex flex-col gap-1 min-w-0">
                      <span className="text-sm font-semibold text-ink truncate">{bro.name}</span>
                      <span className="flex items-center gap-1.5">
                        {isLive && (
                          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-green-700 bg-green-100 px-2 py-0.5 rounded-full shrink-0">
                            <span className="relative flex h-1.5 w-1.5">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75" />
                              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
                            </span>
                            In session
                          </span>
                        )}
                        <LiftBadge profile={bro} />
                      </span>
                    </span>
                  </Link>
                  <div className="flex items-center gap-2 shrink-0 self-start">
                    <button
                      onClick={() => setPendingRemove(bro)}
                      disabled={isRemoving}
                      className="text-ink-6 hover:text-red-500 transition-colors p-2 -m-1.5"
                      aria-label={`Remove ${bro.name}`}
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                        <line x1="2" y1="2" x2="12" y2="12" />
                        <line x1="12" y1="2" x2="2" y2="12" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-ink-6 font-semibold">BW</p>
                    <p className="text-sm font-medium text-ink-2">{bro.bw} kg</p>
                  </div>
                  {isLiftFocused(bro) ? (
                    <>
                      <div>
                        <p className="text-[10px] uppercase tracking-widest text-ink-6 font-semibold">Current</p>
                        <p className="text-sm font-medium text-ink-2">{bro.anchor ?? "—"} kg</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-widest text-ink-6 font-semibold">Target</p>
                        <p className="text-sm font-medium text-ink-2">{bro.target ?? "—"} kg</p>
                      </div>
                    </>
                  ) : (
                    /* A Balanced gymbro has no anchor or target to show */
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-ink-6 font-semibold">Last active</p>
                      <p className="text-sm font-medium text-ink-2">
                        {bro.lastSessionDate ? relativeDate(bro.lastSessionDate) : "never"}
                      </p>
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* Remove gymbro confirmation */}
      {pendingRemove && (
        <div
          role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
          onClick={() => setPendingRemove(null)}
        >
          <EscapeKey onEscape={() => setPendingRemove(null)} />
          <div
            className="bg-raised w-full max-w-[393px] rounded-t-2xl px-6 pt-6 pb-10 max-h-[90dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-base font-semibold text-ink mb-1">
              Remove {pendingRemove.name}?
            </p>
            <p className="text-sm text-ink-5 mb-6">
              You&apos;ll both stop seeing each other&apos;s sessions. You can add them back by email
              any time.
            </p>
            <button
              onClick={() => handleRemoveFriend(pendingRemove.email)}
              className="w-full bg-red-500 text-white text-sm font-semibold rounded-xl py-3.5 hover:bg-red-600 active:bg-red-700 transition-colors mb-3"
            >
              Remove gymbro
            </button>
            <button
              onClick={() => setPendingRemove(null)}
              className="w-full border border-line rounded-xl py-3 text-sm font-semibold text-ink hover:bg-surface-1 active:bg-surface-2 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </main>
  )
}
