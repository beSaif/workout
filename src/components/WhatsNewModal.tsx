"use client"

import { useState } from "react"
import { WhatsNewRelease, pendingWhatsNew, loadWhatsNewSeen, markWhatsNewSeen, WHATS_NEW_VERSION } from "@/lib/whatsNew"
import EscapeKey from "@/components/EscapeKey"

interface WhatsNewModalProps {
  releases: WhatsNewRelease[]
  onDismiss: () => void
}

export default function WhatsNewModal({ releases, onDismiss }: WhatsNewModalProps) {
  const items = releases.flatMap((r) => r.items)
  if (items.length === 0) return null

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
      <EscapeKey onEscape={onDismiss} />
      <div className="bg-raised w-full max-w-[393px] rounded-t-2xl px-6 pt-6 pb-10 max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-brand bg-brand-tint rounded-full px-2 py-0.5">
            New
          </span>
          <p className="text-base font-semibold text-ink">What&apos;s new</p>
        </div>
        <p className="text-sm text-ink-5 mb-5">A few things changed since you were last here.</p>

        <div className="space-y-4 mb-6">
          {items.map((item) => (
            <div key={item.title} className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-brand-fill mt-1.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-ink">{item.title}</p>
                <p className="text-sm text-ink-5 mt-0.5">{item.body}</p>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={onDismiss}
          className="w-full bg-brand-fill text-white text-sm font-semibold rounded-xl py-3.5 hover:bg-brand-fill-2 active:bg-brand-fill-3 transition-colors"
        >
          Got it
        </button>
      </div>
    </div>
  )
}

// ── Hook for consumers ────────────────────────────────────────────────────────

export function useWhatsNew() {
  const [releases, setReleases] = useState<WhatsNewRelease[]>([])

  /** Call once the user is known to be onboarded, so fresh sign-ups never see it. */
  function trigger() {
    if (typeof window === "undefined") return
    const seen = loadWhatsNewSeen()
    const pending = pendingWhatsNew(seen)
    // Nothing recorded on this device (a new phone, cleared storage): which releases
    // they already saw elsewhere is unknown, so show only the latest, not the backlog.
    if (pending.length > 0) setReleases(seen === 0 ? pending.slice(0, 1) : pending)
  }

  function dismiss() {
    markWhatsNewSeen(WHATS_NEW_VERSION)
    setReleases([])
  }

  return { show: releases.length > 0, releases, trigger, dismiss }
}
