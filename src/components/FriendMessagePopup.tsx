"use client"

import { useState } from "react"
import Link from "next/link"
import MessageComposer from "@/components/MessageComposer"
import { GymbroMessage, UserPresence } from "@/lib/types"
import EscapeKey from "@/components/EscapeKey"

function initials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
}

interface Props {
  friend: UserPresence
  messages: GymbroMessage[]
  onClose: () => void
}

export default function FriendMessagePopup({ friend, messages, onClose }: Props) {
  const [composing, setComposing] = useState(false)

  return (
    <div
      role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-end bg-black/50 animate-fade-in"
      onClick={onClose}
    >
      <EscapeKey onEscape={onClose} />
      <div
        className="bg-zinc-900 rounded-t-3xl w-full overflow-hidden animate-slide-up pb-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag pill */}
        <div className="w-10 h-1 rounded-full bg-zinc-700 mx-auto mt-3 mb-1" />

        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-4 pb-4 border-b border-zinc-800">
          <div className="w-10 h-10 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-bold text-zinc-200 shrink-0 select-none">
            {initials(friend.name)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-sm leading-tight truncate">{friend.name}</p>
            <p className="text-zinc-500 text-[11px] mt-0.5">
              {messages.length} message{messages.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 transition-colors shrink-0"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="4" y1="4" x2="14" y2="14" />
              <line x1="14" y1="4" x2="4" y2="14" />
            </svg>
          </button>
        </div>

        {/* Messages */}
        <div className="px-5 py-4 flex flex-col gap-2 max-h-60 overflow-y-auto">
          {messages.length === 0 ? (
            <p className="text-zinc-500 text-sm text-center py-4">no messages</p>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} className="bg-zinc-800 rounded-2xl px-4 py-3">
                <p className="text-white text-sm leading-relaxed">{msg.text}</p>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-5 flex flex-col gap-2 border-t border-zinc-800 pt-4">
          {composing ? (
            <MessageComposer
              recipientLabel={friend.name.split(" ")[0]}
              toEmail={friend.email}
              onSent={onClose}
              onClose={() => setComposing(false)}
            />
          ) : (
            <>
              <Link
                href={`/friends/${encodeURIComponent(friend.email)}`}
                onClick={onClose}
                className="w-full py-3 bg-white text-zinc-900 text-sm font-semibold rounded-xl text-center hover:bg-zinc-100 active:scale-95 transition-all"
              >
                View Profile →
              </Link>
              <button
                onClick={() => setComposing(true)}
                className="w-full py-3 bg-zinc-800 text-white text-sm font-semibold rounded-xl hover:bg-zinc-700 active:scale-95 transition-all"
              >
                Reply 💬
              </button>
              <button
                onClick={onClose}
                className="w-full py-2 text-zinc-500 text-sm hover:text-zinc-300 transition-colors"
              >
                close
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
