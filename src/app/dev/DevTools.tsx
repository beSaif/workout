"use client"

import { useState, useEffect, useSyncExternalStore } from "react"
import Link from "next/link"
import { signOut } from "next-auth/react"
import { blocksCache, clearSessionsLocal, saveAll, sessionsCache, wipeLocalUserData } from "@/lib/storage"
import { useLocalValue } from "@/lib/useLocalValue"
import { recalibrate } from "@/lib/recalibrate"
import { resetToFirstBlock } from "@/lib/layoff"
import { Session, TrainingBlock } from "@/lib/types"

type KvStatus = "loading" | "ok" | "error"
type Copied = "local" | "kv" | null
type NotifStatus = "idle" | "requesting" | "scheduled" | "no-sw" | "denied"

function noopSubscribe() {
  return () => {}
}

interface StoredData {
  sessions: Session[]
  blocks: TrainingBlock[]
}

export default function DevTools() {
  // Read straight from localStorage, so every button below that writes it shows here.
  const localSessions = useLocalValue(sessionsCache)
  const localBlocks = useLocalValue(blocksCache)
  const localData: StoredData = { sessions: localSessions ?? [], blocks: localBlocks ?? [] }
  const [kvData, setKvData] = useState<StoredData | null>(null)
  const [kvStatus, setKvStatus] = useState<KvStatus>("loading")
  const [copied, setCopied] = useState<Copied>(null)

  useEffect(() => {
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((data) => {
        if (data && typeof data === "object" && !Array.isArray(data) && Array.isArray(data.sessions)) {
          setKvData(data as StoredData)
        } else if (Array.isArray(data)) {
          setKvData({ sessions: data, blocks: [] })
        } else {
          setKvData({ sessions: [], blocks: [] })
        }
        setKvStatus("ok")
      })
      .catch(() => setKvStatus("error"))
  }, [])

  function copy(data: unknown, which: Copied) {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2))
    setCopied(which)
    setTimeout(() => setCopied(null), 2000)
  }

  function clearLocal() {
    if (!confirm("Clear localStorage? This cannot be undone.")) return
    clearSessionsLocal()
  }

  function pullFromKV() {
    if (!kvData) return
    saveAll(kvData.sessions, kvData.blocks)
  }

  function pushToKV() {
    saveAll(localData.sessions, localData.blocks)
  }

  async function deleteAccount() {
    if (!confirm("Delete everything? This wipes your profile, sessions, blocks, and exercises from KV and localStorage. Cannot be undone.")) return
    await fetch("/api/profile", { method: "DELETE" })
    wipeLocalUserData()
    await signOut({ callbackUrl: "/welcome" })
  }

  const kvCount = kvData?.sessions.length ?? 0

  const [recalNotes, setRecalNotes] = useState<string[] | null>(null)

  function runRecalibrate() {
    if (!confirm("Recalibrate? This fixes block/session bookkeeping, re-derives rebuild loads from what you actually lifted, and regenerates the upcoming session.")) return
    const { sessions, blocks, notes } = recalibrate(localData.sessions, localData.blocks)
    saveAll(sessions, blocks)
    setRecalNotes(notes)
  }

  const [resetNotes, setResetNotes] = useState<string[] | null>(null)

  function runResetBlock() {
    const active = localData.blocks.find((b) => b.status === "active")
    const anchor = active?.anchorWeight ?? localData.blocks[localData.blocks.length - 1]?.anchorWeight ?? 60
    if (
      !confirm(
        `Reset to session 1 of block 1 at ${anchor}kg? Your logged sessions stay in history; only the block structure is cleared.`
      )
    )
      return
    const { sessions, blocks, notes } = resetToFirstBlock(localData.sessions, localData.blocks)
    saveAll(sessions, blocks)
    setResetNotes(notes)
  }

  // Read through a store with a server snapshot: reading it during render made the
  // server HTML ("unavailable") disagree with the client's first render.
  const notifPermission = useSyncExternalStore(
    noopSubscribe,
    () => (typeof Notification !== "undefined" ? Notification.permission : "unavailable"),
    () => "unavailable"
  )
  const [notifStatus, setNotifStatus] = useState<NotifStatus>("idle")
  const [notifCountdown, setNotifCountdown] = useState<number | null>(null)

  async function testNotification(delaySecs: number) {
    setNotifStatus("requesting")
    if (!("serviceWorker" in navigator)) { setNotifStatus("no-sw"); return }

    let perm = Notification.permission
    if (perm === "default") perm = await Notification.requestPermission()
    if (perm !== "granted") { setNotifStatus("denied"); return }

    const reg = await navigator.serviceWorker.ready
    if (!reg.active) { setNotifStatus("no-sw"); return }

    const id = "dev-test-" + Date.now()
    reg.active.postMessage({
      type: "SCHEDULE",
      id,
      delay: delaySecs * 1000,
      title: "Test notification",
      body: "Notification system working!",
      icon: "/apple-icon",
    })

    setNotifStatus("scheduled")
    setNotifCountdown(delaySecs)
    const tick = setInterval(() => {
      setNotifCountdown((c) => {
        if (c === null || c <= 1) { clearInterval(tick); setNotifStatus("idle"); return null }
        return c - 1
      })
    }, 1000)
  }

  return (
    <main className="mx-auto w-full max-w-[393px] px-4 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-6">
      <header className="mb-6 flex items-center gap-4">
        <Link href="/" className="text-sm text-ink-5">← Back</Link>
        <h1 className="text-2xl font-semibold text-ink tracking-tight">Dev Tools</h1>
      </header>

      {/* localStorage */}
      <section className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-ink">
            localStorage{" "}
            <span className="text-ink-5 font-normal">({localData.sessions.length} sessions · {localData.blocks.length} blocks)</span>
          </h2>
          <div className="flex items-center gap-3">
            <button
              onClick={() => copy(localData, "local")}
              className="text-xs font-medium text-brand"
            >
              {copied === "local" ? "Copied!" : "Copy JSON"}
            </button>
            <button onClick={clearLocal} className="text-xs text-ink-6">
              Clear
            </button>
          </div>
        </div>
        <pre className="bg-surface-2 rounded-xl p-3 text-[11px] leading-relaxed text-ink-2 overflow-x-auto max-h-52 overflow-y-auto">
          {JSON.stringify(localData, null, 2)}
        </pre>
      </section>

      {/* Vercel KV */}
      <section className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-ink">
            Vercel KV{" "}
            <span className="text-ink-5 font-normal">
              {kvStatus === "loading" && "(loading…)"}
              {kvStatus === "error" && "(unavailable)"}
              {kvStatus === "ok" && `(${kvCount} sessions)`}
            </span>
          </h2>
          {kvStatus === "ok" && (
            <button
              onClick={() => copy(kvData, "kv")}
              className="text-xs font-medium text-brand"
            >
              {copied === "kv" ? "Copied!" : "Copy JSON"}
            </button>
          )}
        </div>
        {kvStatus === "ok" && (
          <pre className="bg-surface-2 rounded-xl p-3 text-[11px] leading-relaxed text-ink-2 overflow-x-auto max-h-52 overflow-y-auto">
            {kvCount > 0 ? JSON.stringify(kvData, null, 2) : "{}"}
          </pre>
        )}
        {kvStatus === "loading" && (
          <div className="bg-surface-2 rounded-xl p-4 text-xs text-ink-6">Fetching from KV…</div>
        )}
        {kvStatus === "error" && (
          <div className="bg-surface-2 rounded-xl p-4 text-xs text-ink-6">KV is unavailable in this environment.</div>
        )}
      </section>

      {/* Notifications */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold text-ink mb-1">Notifications</h2>
        <p className="text-xs text-ink-6 mb-3">
          Permission: <span className="font-medium text-ink-2">
            {notifPermission}
          </span>
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => testNotification(5)}
            disabled={notifStatus === "scheduled" || notifStatus === "requesting"}
            className="flex-1 py-3 rounded-xl bg-surface-2 text-sm text-ink disabled:opacity-40"
          >
            Fire in 5s
          </button>
          <button
            onClick={() => testNotification(10)}
            disabled={notifStatus === "scheduled" || notifStatus === "requesting"}
            className="flex-1 py-3 rounded-xl bg-surface-2 text-sm text-ink disabled:opacity-40"
          >
            Fire in 10s
          </button>
        </div>
        {notifStatus === "scheduled" && notifCountdown !== null && (
          <p className="mt-2 text-xs text-brand text-center">Firing in {notifCountdown}s — background the app now</p>
        )}
        {notifStatus === "denied" && (
          <p className="mt-2 text-xs text-red-500 text-center">Permission denied — enable in iOS Settings → Notifications</p>
        )}
        {notifStatus === "no-sw" && (
          <p className="mt-2 text-xs text-red-500 text-center">Service worker not active — reload and try again</p>
        )}
      </section>

      {/* Recalibrate */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold text-ink mb-1">Recalibrate</h2>
        <p className="text-xs text-ink-6 mb-3">
          Repairs data inconsistencies: re-syncs block ↔ session links, re-derives rebuild loads from what you actually lifted (so the next session isn&apos;t too high), and regenerates the upcoming session.
        </p>
        <button
          onClick={runRecalibrate}
          disabled={localData.sessions.length === 0}
          className="w-full py-3 rounded-xl bg-warn-fill text-sm font-semibold text-white disabled:opacity-40"
        >
          Recalibrate data
        </button>
        {recalNotes && (
          <ul className="mt-3 bg-warn-tint rounded-xl p-3 text-[11px] leading-relaxed text-warn list-disc pl-6">
            {recalNotes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        )}
      </section>

      {/* Reset block */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold text-ink mb-1">Reset block</h2>
        <p className="text-xs text-ink-6 mb-3">
          Winds the program back to session 1 of block 1 (Accumulation), carrying over your
          current peak. Every logged session stays in history — only the block
          bookkeeping is cleared. Use after a long layoff.
        </p>
        <button
          onClick={runResetBlock}
          disabled={localData.blocks.length === 0}
          className="w-full py-3 rounded-xl bg-good-fill-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          Reset to block 1, session 1
        </button>
        {resetNotes && (
          <ul className="mt-3 bg-good-tint rounded-xl p-3 text-[11px] leading-relaxed text-good list-disc pl-6">
            {resetNotes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        )}
      </section>

      {/* Sync actions */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold text-ink mb-3">Sync</h2>
        <div className="flex flex-col gap-2">
          <button
            onClick={pullFromKV}
            disabled={kvStatus !== "ok" || kvCount === 0}
            className="w-full py-3 rounded-xl bg-surface-2 text-sm text-ink disabled:opacity-40"
          >
            Pull KV → localStorage
          </button>
          <button
            onClick={pushToKV}
            disabled={localData.sessions.length === 0}
            className="w-full py-3 rounded-xl bg-brand-fill text-sm text-white disabled:opacity-40"
          >
            Push localStorage → KV
          </button>
        </div>
      </section>

      {/* Danger zone */}
      <section className="border-t border-line pt-6">
        <h2 className="text-sm font-semibold text-ink mb-1">Danger zone</h2>
        <p className="text-xs text-ink-6 mb-3">Wipes everything — profile, sessions, blocks, exercises. Signs you out. Use to re-test onboarding.</p>
        <button
          onClick={deleteAccount}
          className="w-full py-3 rounded-xl border-2 border-red-200 text-sm font-semibold text-red-500 hover:bg-red-50 active:bg-red-100 transition-colors"
        >
          Delete account
        </button>
      </section>
    </main>
  )
}
