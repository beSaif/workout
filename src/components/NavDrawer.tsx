"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"
import { loadProfile, wipeLocalUserData } from "@/lib/storage"
import { useNativeInstallPrompt } from "@/lib/installPrompt"
import { dotEnabledSource, saveDotEnabled } from "@/lib/buddy"
import { haptic, hapticsEnabledSource, saveHapticsEnabled } from "@/lib/haptics"
import { useLocalValue } from "@/lib/useLocalValue"
import HapticTap from "@/components/HapticTap"
import EscapeKey from "@/components/EscapeKey"

interface NavDrawerProps {
  open: boolean
  onClose: () => void
}

export default function NavDrawer({ open, onClose }: NavDrawerProps) {
  const pathname = usePathname()
  const [pendingCount, setPendingCount] = useState(0)
  // Someone who declined daily check-ins should see no trace of the feature, this
  // nav entry included. Read asynchronously rather than during render: the drawer is
  // on every page, and reading localStorage in a state initialiser would make the
  // server and client markup disagree.
  const [weighInDaily, setWeighInDaily] = useState(false)
  // Capturing beforeinstallprompt suppresses Chrome's own install banner, so the app
  // owes the user a standing way in — the home-screen sheet is dismissed for good
  // after one tap. Absent once installed, and on browsers with no such API.
  const { available: canInstall, promptInstall } = useNativeInstallPrompt()
  // Device switches. On until read, which is also what an unset switch means.
  const dotOn = useLocalValue(dotEnabledSource) ?? true
  const hapticsOn = useLocalValue(hapticsEnabledSource) ?? true

  useEffect(() => {
    fetch("/api/friends/requests")
      .then((r) => r.ok ? r.json() : { count: 0 })
      .then((d) => { if (typeof d.count === "number") setPendingCount(d.count) })
      .catch(() => {})

    loadProfile()
      .then((p) => { if (p?.weighInDaily) setWeighInDaily(true) })
      .catch(() => {})
  }, [])

  function handleSignOut() {
    wipeLocalUserData()
    signOut({ callbackUrl: "/welcome" })
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/30 transition-opacity duration-200 ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      {/* Drawer panel */}
      {open && <EscapeKey onEscape={onClose} />}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        // Closed, the drawer is only translated off-screen: inert keeps Tab and screen readers out of it.
        inert={!open}
        className={`fixed top-0 left-0 bottom-0 z-50 w-64 bg-raised shadow-2xl transform transition-transform duration-200 ease-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="pt-14 px-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-6 mb-4">
            Menu
          </p>
          <nav className="space-y-1">
            <Link
              href="/"
              onClick={onClose}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                pathname === "/"
                  ? "bg-brand-tint text-brand"
                  : "text-ink-2 hover:bg-surface-2"
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M6.5 14.5v-4h3v4a1 1 0 001 1h3a1 1 0 001-1V7.5h1.5a.5.5 0 00.35-.854l-7-6.5a.5.5 0 00-.7 0l-7 6.5A.5.5 0 001 7.5H2.5v7a1 1 0 001 1h3a1 1 0 001-1z" />
              </svg>
              Home
            </Link>

            <Link
              href="/exercises"
              onClick={onClose}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                pathname === "/exercises"
                  ? "bg-brand-tint text-brand"
                  : "text-ink-2 hover:bg-surface-2"
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                <rect x="1.5" y="6" width="2.5" height="4" rx="0.5" />
                <rect x="12" y="6" width="2.5" height="4" rx="0.5" />
                <line x1="4" y1="8" x2="5.5" y2="8" />
                <line x1="10.5" y1="8" x2="12" y2="8" />
                <rect x="5.5" y="4.5" width="5" height="7" rx="0.5" />
              </svg>
              Exercise Selection
            </Link>

            <Link
              href="/history"
              onClick={onClose}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                pathname === "/history"
                  ? "bg-brand-tint text-brand"
                  : "text-ink-2 hover:bg-surface-2"
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="8" cy="8" r="6.5" />
                <polyline points="8,4.5 8,8 10.5,9.5" />
              </svg>
              History
            </Link>

            {weighInDaily && (
              <Link
                href="/weight"
                onClick={onClose}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  pathname === "/weight"
                    ? "bg-brand-tint text-brand"
                    : "text-ink-2 hover:bg-surface-2"
                }`}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="1.5,11 5.5,6.5 8.5,9 14.5,3" />
                  <polyline points="11,3 14.5,3 14.5,6.5" />
                </svg>
                Weight
              </Link>
            )}

            <Link
              href="/gymbros"
              onClick={onClose}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                pathname === "/gymbros"
                  ? "bg-brand-tint text-brand"
                  : "text-ink-2 hover:bg-surface-2"
              }`}
            >
              <span className="relative">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="5.5" cy="5" r="2.5" />
                  <circle cx="10.5" cy="5" r="2.5" />
                  <path d="M1 13.5c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" />
                  <path d="M10.5 9.5c2 0 4 1 4 4" />
                </svg>
                {pendingCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-0.5 leading-none">
                    {pendingCount > 9 ? "9+" : pendingCount}
                  </span>
                )}
              </span>
              Gymbros
            </Link>

            <Link
              href="/profile"
              onClick={onClose}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                pathname === "/profile"
                  ? "bg-brand-tint text-brand"
                  : "text-ink-2 hover:bg-surface-2"
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="8" cy="5" r="2.75" />
                <path d="M2.5 14c0-3 2.5-4.5 5.5-4.5s5.5 1.5 5.5 4.5" />
              </svg>
              Profile
            </Link>
          </nav>

          <div className="mt-8 pt-4 border-t border-line-soft">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-6 mb-1 px-3">
              Dot
            </p>
            <SwitchRow
              label="Show Dot"
              checked={dotOn}
              onChange={(on) => saveDotEnabled(on)}
            />
            <SwitchRow
              label="Haptics"
              checked={hapticsOn}
              tickOnTap={!hapticsOn}
              onChange={(on) => {
                saveHapticsEnabled(on)
                // A buzz on the way on says what the switch does.
                if (on) haptic("tap")
              }}
            />
          </div>

          <div className="mt-4 pt-4 border-t border-line-soft">
            {canInstall && (
              <button
                onClick={() => { promptInstall().then((accepted) => { if (accepted) onClose() }) }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-ink-2 hover:bg-surface-2 transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M8 2v8" />
                  <polyline points="4.5,6.5 8,10 11.5,6.5" />
                  <path d="M2.5 11.5v1.5a1 1 0 001 1h9a1 1 0 001-1v-1.5" />
                </svg>
                Install app
              </button>
            )}

            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-ink-5 hover:bg-surface-2 transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 14H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h3" />
                <polyline points="10.5,11.5 14,8 10.5,4.5" />
                <line x1="14" y1="8" x2="6" y2="8" />
              </svg>
              Sign out
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

function SwitchRow({
  label,
  checked,
  onChange,
  tickOnTap,
}: {
  label: string
  checked: boolean
  onChange: (on: boolean) => void
  /** iPhone: whether this tap ticks, whatever the Haptics setting says. */
  tickOnTap?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="relative w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-ink-2 hover:bg-surface-2 transition-colors"
    >
      {label}
      <span
        aria-hidden="true"
        className={`relative w-9 h-5 rounded-full shrink-0 transition-colors duration-200 ${
          checked ? "bg-brand-fill" : "bg-surface-5"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
            checked ? "translate-x-4" : ""
          }`}
        />
      </span>
      {tickOnTap != null && <HapticTap when={tickOnTap} />}
    </button>
  )
}
