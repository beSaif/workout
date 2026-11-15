"use client"

import { useState } from "react"
import { UserProfile, TRAINING_MODE_LABEL } from "@/lib/types"
import { isLiftFocused } from "@/lib/trainingMode"
import { ROAST_PRESETS } from "@/lib/messages"
import EscapeKey from "@/components/EscapeKey"

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
}

interface Props {
  friends: UserProfile[]
  /** Set when the session just confirmed raised the best e1RM. */
  pr?: { e1rm: number; previous: number } | null
  /** Short main-lift label for the PR line, e.g. "Bench". */
  liftLabel?: string
  onClose: () => void
  onShareWorkout?: () => void
}

function formatKg(kg: number): string {
  return String(Math.round(kg * 10) / 10)
}

export default function HypePanelModal({ friends, pr, liftLabel, onClose, onShareWorkout }: Props) {
  const autoSelected = friends.length === 1 ? friends[0] : null
  const [pickedFriend, setPickedFriend] = useState<UserProfile | null>(autoSelected)
  const [blastAll, setBlastAll] = useState(false)
  const [custom, setCustom] = useState("")
  const [sending, setSending] = useState(false)
  const [sentText, setSentText] = useState<string | null>(null)

  const inComposer = blastAll || pickedFriend !== null
  const recipientLabel = blastAll
    ? "all gymbros"
    : pickedFriend?.name.split(" ")[0] ?? ""
  const toEmail = blastAll ? "all" : pickedFriend?.email ?? ""

  async function send(text: string) {
    if (sending || !toEmail) return
    setSending(true)
    try {
      await fetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toEmail, text }),
      })
      setSentText(text)
    } finally {
      setSending(false)
    }
  }

  if (sentText !== null) {
    return (
      <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-zinc-950 px-8 animate-fade-in">
        <div className="flex flex-col items-center gap-5 text-center">
          <span className="text-7xl animate-bounce-in select-none">🔥</span>
          <div className="flex flex-col gap-1">
            <p className="text-white text-2xl font-bold tracking-tight">sent</p>
            <p className="text-zinc-500 text-sm mt-0.5 max-w-[240px] leading-relaxed">
              &ldquo;{sentText}&rdquo;
            </p>
          </div>
          <div className="flex flex-col items-center gap-2 mt-2">
            {onShareWorkout && (
              <button
                onClick={onShareWorkout}
                className="px-8 py-3 rounded-full bg-white text-zinc-900 text-sm font-semibold hover:bg-zinc-100 active:scale-95 transition-all"
              >
                share this session 📸
              </button>
            )}
            <button
              onClick={onClose}
              className="px-8 py-3 rounded-full bg-zinc-800 text-zinc-300 text-sm font-medium hover:bg-zinc-700 active:scale-95 transition-all"
            >
              close
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex flex-col bg-zinc-950 animate-slide-up"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <EscapeKey onEscape={onClose} />
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 pt-5 pb-2">
        {inComposer && !blastAll && friends.length > 1 ? (
          <button
            onClick={() => setPickedFriend(null)}
            className="flex items-center gap-1.5 text-zinc-400 hover:text-white text-sm transition-colors active:scale-95"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="10,4 6,8 10,12" />
            </svg>
            back
          </button>
        ) : inComposer && blastAll ? (
          <button
            onClick={() => setBlastAll(false)}
            className="flex items-center gap-1.5 text-zinc-400 hover:text-white text-sm transition-colors active:scale-95"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="10,4 6,8 10,12" />
            </svg>
            back
          </button>
        ) : (
          <div />
        )}
        <div className="flex items-center gap-4">
          {!inComposer && onShareWorkout && (
            <button
              onClick={onShareWorkout}
              className="text-white hover:text-zinc-200 text-sm font-medium transition-colors active:scale-95"
            >
              share 📸
            </button>
          )}
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
          >
            skip
          </button>
        </div>
      </div>

      {/* Title block */}
      <div className="px-6 pt-4 pb-6 animate-fade-up">
        {pr && !inComposer && (
          <div className="mb-6 rounded-2xl bg-amber-400/10 border border-amber-400/30 px-4 py-3.5">
            <p className="text-amber-300 text-xs uppercase tracking-widest font-semibold">
              new {liftLabel ? `${liftLabel} ` : ""}e1RM PR 🏆
            </p>
            <p className="text-white text-3xl font-bold tracking-tight mt-1">{formatKg(pr.e1rm)} kg</p>
            <p className="text-zinc-400 text-xs mt-0.5">
              +{formatKg(pr.e1rm - pr.previous)} kg on your previous best of {formatKg(pr.previous)} kg
            </p>
          </div>
        )}
        {!inComposer && friends.length === 0 ? (
          <p className="text-zinc-500 text-xs uppercase tracking-widest font-semibold mb-1">
            session done
          </p>
        ) : !inComposer ? (
          <>
            <p className="text-zinc-500 text-xs uppercase tracking-widest font-semibold mb-1">
              session done
            </p>
            <h2 className="text-[2rem] font-bold text-white tracking-tight leading-tight">
              who you
              <br />
              roasting? 😤
            </h2>
          </>
        ) : (
          <>
            <p className="text-zinc-500 text-xs uppercase tracking-widest font-semibold mb-1">
              roasting
            </p>
            <h2 className="text-[2rem] font-bold text-white tracking-tight leading-tight">
              {recipientLabel}
            </h2>
          </>
        )}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-5 pb-8">

        {/* Friend picker */}
        {!inComposer && (
          <div className="flex flex-col gap-2">
            {friends.length === 0 ? (
              onShareWorkout && (
                <button
                  onClick={onShareWorkout}
                  className="w-full py-3.5 rounded-2xl bg-white text-zinc-900 text-sm font-semibold hover:bg-zinc-100 active:scale-[0.98] transition-all"
                >
                  share this session 📸
                </button>
              )
            ) : (
              <>
                {friends.map((f, i) => (
                  <button
                    key={f.email}
                    onClick={() => setPickedFriend(f)}
                    className="flex items-center gap-3 w-full px-4 py-3.5 rounded-2xl bg-zinc-900 hover:bg-zinc-800 active:scale-[0.98] active:bg-zinc-800 transition-all text-left animate-fade-up"
                    style={{ animationDelay: `${i * 55}ms` }}
                  >
                    <div className="w-10 h-10 rounded-full bg-zinc-700 flex items-center justify-center text-[13px] font-bold text-zinc-200 shrink-0 select-none">
                      {initials(f.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-semibold text-[15px] leading-tight">{f.name}</p>
                      {/* A Balanced gymbro has no anchor; show their mode instead */}
                      <p className="text-zinc-500 text-xs mt-0.5">
                        {isLiftFocused(f) ? `${f.anchor ?? "—"} kg` : TRAINING_MODE_LABEL.balanced}
                      </p>
                    </div>
                    <svg className="text-zinc-600 shrink-0" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6,4 10,8 6,12" />
                    </svg>
                  </button>
                ))}
                <button
                  onClick={() => setBlastAll(true)}
                  className="w-full mt-1 py-3.5 text-zinc-500 text-sm hover:text-zinc-300 transition-colors animate-fade-up"
                  style={{ animationDelay: `${friends.length * 55}ms` }}
                >
                  or blast everyone →
                </button>
              </>
            )}
          </div>
        )}

        {/* Composer */}
        {inComposer && (
          <div className="flex flex-col gap-2.5">
            {ROAST_PRESETS.map((p, i) => (
              <button
                key={p}
                onClick={() => send(p)}
                disabled={sending}
                className="w-full text-left px-5 py-4 rounded-2xl bg-zinc-900 hover:bg-zinc-800 active:scale-[0.97] active:bg-zinc-800 transition-all text-white font-medium text-[15px] leading-snug disabled:opacity-40 animate-fade-up"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                {p}
              </button>
            ))}

            <div
              className="flex gap-2 mt-2 animate-fade-up"
              style={{ animationDelay: "300ms" }}
            >
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" && custom.trim() && send(custom.trim())
                }
                placeholder="or type your own..."
                maxLength={300}
                className="flex-1 bg-zinc-900 rounded-xl px-4 py-3.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-700 transition-shadow"
              />
              <button
                onClick={() => custom.trim() && send(custom.trim())}
                disabled={!custom.trim() || sending}
                className="px-5 py-3.5 bg-white text-zinc-900 font-semibold text-sm rounded-xl disabled:opacity-25 hover:bg-zinc-100 active:scale-95 transition-all"
              >
                send
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
