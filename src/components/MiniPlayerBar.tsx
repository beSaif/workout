"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { loadMiniPlayer, clearMiniPlayer, MiniPlayerState } from "@/lib/storage"

function formatSeconds(s: number): string {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${String(sec).padStart(2, "0")}`
}

export default function MiniPlayerBar() {
  const router = useRouter()
  const [miniState, setMiniState] = useState<MiniPlayerState | null>(null)
  const [restSeconds, setRestSeconds] = useState<number | null>(null)

  // Load from localStorage and listen for updates
  useEffect(() => {
    const load = () => setMiniState(loadMiniPlayer())
    load()
    window.addEventListener("mini-player-update", load)
    return () => window.removeEventListener("mini-player-update", load)
  }, [])

  // Tick rest timer down
  useEffect(() => {
    if (!miniState?.restEndTime) return
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((miniState.restEndTime! - Date.now()) / 1000))
      setRestSeconds(remaining > 0 ? remaining : null)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => {
      clearInterval(id)
      setRestSeconds(null)
    }
  }, [miniState?.restEndTime])

  if (!miniState) return null

  function handleTap() {
    const sessionId = String(miniState!.sessionId)
    clearMiniPlayer()
    setMiniState(null)
    // Fire event first so home page can handle it if already mounted
    window.dispatchEvent(new CustomEvent("mini-player-resume", { detail: { sessionId } }))
    // Also set sessionStorage as fallback for cross-page navigation
    sessionStorage.setItem("lift-tracker-resume", sessionId)
    router.push("/")
  }

  const { label, setsCompleted, totalSets } = miniState

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-raised border-t border-line shadow-[0_-2px_12px_rgba(0,0,0,0.08)] flex justify-center pb-[calc(env(safe-area-inset-bottom)+8px)]">
      <button
        onClick={handleTap}
        className="w-full max-w-[393px] mx-0 bg-surface flex items-center px-4 py-4 gap-3 active:bg-surface-2 transition-colors"
        aria-label="Return to session"
      >
        {/* Pulsing dot */}
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-fill opacity-60" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-fill" />
        </span>

        {/* Label + progress */}
        <div className="flex-1 min-w-0 text-left">
          <p className="text-sm font-semibold text-ink truncate">{label}</p>
          <p className="text-xs text-ink-5">
            {setsCompleted} / {totalSets} sets
          </p>
        </div>

        {/* Rest timer (if active) */}
        {restSeconds !== null && (
          <span className="text-sm font-bold tabular-nums text-brand shrink-0">
            {formatSeconds(restSeconds)}
          </span>
        )}

        {/* Expand chevron */}
        <svg
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          stroke="var(--color-ink-5)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0"
        >
          <polyline points="4 11 9 6 14 11" />
        </svg>
      </button>
    </div>
  )
}
