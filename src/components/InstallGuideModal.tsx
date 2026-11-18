"use client"

import { useState } from "react"

import { useNativeInstallPrompt } from "@/lib/installPrompt"
import { loadInstallGuideDismissed, saveInstallGuideDismissed } from "@/lib/storage"
import EscapeKey from "@/components/EscapeKey"

type Platform = "ios" | "android" | "other"

function detectPlatform(): Platform {
  const ua = navigator.userAgent
  if (/iphone|ipad|ipod/i.test(ua)) return "ios"
  if (/android/i.test(ua)) return "android"
  return "other"
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

// ── Step illustration SVGs ────────────────────────────────────────────────────

function IOSShareIcon() {
  return (
    <svg viewBox="0 0 44 44" fill="none" className="w-full h-full">
      <rect width="44" height="44" rx="10" fill="#F2F2F7" />
      <path
        d="M22 8v18M16 14l6-6 6 6"
        stroke="#007AFF"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14 22v10a1 1 0 001 1h14a1 1 0 001-1V22"
        stroke="#007AFF"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IOSAddToHomeIcon() {
  return (
    <svg viewBox="0 0 44 44" fill="none" className="w-full h-full">
      <rect width="44" height="44" rx="10" fill="#F2F2F7" />
      <rect x="10" y="14" width="24" height="16" rx="4" fill="white" stroke="#C7C7CC" strokeWidth="1.5" />
      <path d="M18 22h8M22 18v8" stroke="#007AFF" strokeWidth="2.5" strokeLinecap="round" />
      <rect x="10" y="32" width="24" height="5" rx="2.5" fill="#E5E5EA" />
    </svg>
  )
}

function IOSDoneIcon() {
  return (
    <svg viewBox="0 0 44 44" fill="none" className="w-full h-full">
      <rect width="44" height="44" rx="10" fill="#1e3a5f" />
      <path
        d="M14 22l6 6 10-12"
        stroke="white"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function AndroidMenuIcon() {
  return (
    <svg viewBox="0 0 44 44" fill="none" className="w-full h-full">
      <rect width="44" height="44" rx="10" fill="#F2F2F7" />
      <circle cx="22" cy="14" r="2.5" fill="#3C4043" />
      <circle cx="22" cy="22" r="2.5" fill="#3C4043" />
      <circle cx="22" cy="30" r="2.5" fill="#3C4043" />
    </svg>
  )
}

function AndroidInstallIcon() {
  return (
    <svg viewBox="0 0 44 44" fill="none" className="w-full h-full">
      <rect width="44" height="44" rx="10" fill="#F2F2F7" />
      <rect x="10" y="12" width="24" height="18" rx="3" fill="white" stroke="#C7C7CC" strokeWidth="1.5" />
      <path d="M22 16v8M18 21l4 4 4-4" stroke="#1A73E8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="10" y="32" width="24" height="4" rx="2" fill="#E5E5EA" />
    </svg>
  )
}

function AndroidDoneIcon() {
  return (
    <svg viewBox="0 0 44 44" fill="none" className="w-full h-full">
      <rect width="44" height="44" rx="10" fill="#1e3a5f" />
      <path
        d="M14 22l6 6 10-12"
        stroke="white"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ── Step data ─────────────────────────────────────────────────────────────────

const IOS_STEPS = [
  {
    icon: <IOSShareIcon />,
    title: "tap share",
    desc: "hit the share button at the bottom of Safari — it looks like a box with an arrow coming out of it.",
  },
  {
    icon: <IOSAddToHomeIcon />,
    title: "add to home screen",
    desc: 'scroll down in that menu until you see "Add to Home Screen" and tap it.',
  },
  {
    icon: <IOSDoneIcon />,
    title: "done",
    desc: "tap Add in the top right. the app shows up on your home screen and opens without the browser bar.",
  },
]

const ANDROID_STEPS = [
  {
    icon: <AndroidMenuIcon />,
    title: "open the menu",
    desc: "tap the three-dot menu in the top-right corner of Chrome.",
  },
  {
    icon: <AndroidInstallIcon />,
    title: "add to home screen",
    desc: 'tap "Add to Home screen" or "Install app" — wording depends on your Chrome version.',
  },
  {
    icon: <AndroidDoneIcon />,
    title: "done",
    desc: "hit Add when the popup shows. it'll sit on your home screen like any other app.",
  },
]

// ── Component ─────────────────────────────────────────────────────────────────

interface InstallGuideModalProps {
  onDismiss: () => void
}

export default function InstallGuideModal({ onDismiss }: InstallGuideModalProps) {
  // Only ever mounted on the client, after the home page has loaded, so navigator is there.
  const [platform] = useState<Platform>(() => (typeof navigator === "undefined" ? "other" : detectPlatform()))
  const { available: nativeInstall, promptInstall } = useNativeInstallPrompt()
  // The written steps are the fallback, not the pitch: when the browser can show the
  // real system dialog we lead with that and only unfold the steps if it goes unused.
  const [showSteps, setShowSteps] = useState(false)
  const [installing, setInstalling] = useState(false)

  function dismiss() {
    saveInstallGuideDismissed()
    onDismiss()
  }

  async function install() {
    setInstalling(true)
    const accepted = await promptInstall()
    setInstalling(false)
    // Accepting installs the app, so the sheet has done its job. Declining leaves them
    // on the steps — the event is spent and cannot be fired a second time.
    if (accepted) dismiss()
    else setShowSteps(true)
  }

  const steps = platform === "ios" ? IOS_STEPS : ANDROID_STEPS
  const platformLabel = platform === "ios" ? "Safari" : "Chrome"
  const stepsVisible = showSteps || !nativeInstall

  if (platform === "other") {
    // Desktop or unsupported — just skip
    return (
      <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
        <EscapeKey onEscape={dismiss} />
        <div className="w-full max-w-[430px] bg-raised rounded-t-2xl px-6 pt-6 pb-10 shadow-2xl max-h-[90dvh] overflow-y-auto">
          <p className="text-lg font-semibold text-ink mb-2">open this on your phone</p>
          <p className="text-sm text-ink-5 mb-6">
            for the best experience — and so you can log sets in the gym — visit this on your phone and add it to your home screen.
          </p>
          <button
            onClick={dismiss}
            className="w-full bg-brand-fill text-white text-sm font-semibold rounded-xl py-3.5"
          >
            got it
          </button>
        </div>
      </div>
    )
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
      <EscapeKey onEscape={dismiss} />
      <div className="w-full max-w-[430px] bg-raised rounded-t-2xl px-6 pt-6 pb-10 shadow-2xl max-h-[90dvh] overflow-y-auto">
        {/* Header */}
        <div className="mb-6">
          <p className="text-lg font-semibold text-ink leading-snug mb-1">
            add this to your home screen
          </p>
          <p className="text-sm text-ink-5">
            takes 5 seconds. opens like a real app — no browser bar, no distractions. way better for tracking in the gym.
          </p>
        </div>

        {/* Steps — hidden while the one-tap install is still on offer */}
        {stepsVisible && (
          <>
            <div className="space-y-4 mb-7">
              {steps.map((step, i) => (
                <div key={i} className="flex items-start gap-4">
                  <div className="w-11 h-11 shrink-0">{step.icon}</div>
                  <div className="flex-1 pt-0.5">
                    <p className="text-sm font-semibold text-ink mb-0.5">
                      {i + 1}. {step.title}
                    </p>
                    <p className="text-sm text-ink-5 leading-snug">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <p className="text-xs text-ink-6 text-center mb-4">
              open in {platformLabel} if you&apos;re not already
            </p>
          </>
        )}

        {/* CTA */}
        {nativeInstall ? (
          <button
            onClick={install}
            disabled={installing}
            className="w-full bg-brand-fill text-white text-sm font-semibold rounded-xl py-3.5 active:bg-brand-fill-3 transition-colors disabled:opacity-60"
          >
            {installing ? "installing…" : "install app"}
          </button>
        ) : (
          <button
            onClick={dismiss}
            className="w-full bg-brand-fill text-white text-sm font-semibold rounded-xl py-3.5 active:bg-brand-fill-3 transition-colors"
          >
            on it
          </button>
        )}
        <button
          onClick={dismiss}
          className="w-full text-sm text-ink-6 py-3 mt-1"
        >
          maybe later
        </button>
      </div>
    </div>
  )
}

// ── Hook for consumers ────────────────────────────────────────────────────────

export function useInstallGuide() {
  const [show, setShow] = useState(false)

  function trigger() {
    if (typeof window === "undefined") return
    if (isStandalone()) return
    if (loadInstallGuideDismissed()) return
    setShow(true)
  }

  function dismiss() {
    saveInstallGuideDismissed()
    setShow(false)
  }

  return { show, trigger, dismiss }
}
