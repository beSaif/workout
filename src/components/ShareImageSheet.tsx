"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import EscapeKey from "@/components/EscapeKey"

interface Props {
  /** Top-bar label, lowercase like the rest of the share UI. */
  title: string
  /** Download name for the PNG, extension included. */
  fileName: string
  alt: string
  /**
   * Snapshots whatever the caller wants shared. Called once, after fonts have
   * loaded and a frame has painted, so the node it reads is settled.
   */
  capture: () => Promise<Blob | null>
  onClose: () => void
}

type Status = "loading" | "ready" | "error"

/**
 * The share sheet: preview, then share / save / copy. Capturing is the caller's
 * job — a session card is rendered offscreen at full width, a gymbro card is
 * snapshotted where it already sits — so everything below only ever sees a blob.
 */
export default function ShareImageSheet({ title, fileName, alt, capture, onClose }: Props) {
  const blobRef = useRef<Blob | null>(null)
  const [status, setStatus] = useState<Status>("loading")
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  // Feature detection (client-only to avoid hydration surprises).
  const [canShare, setCanShare] = useState(false)
  const [canCopy, setCanCopy] = useState(false)
  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function")
    setCanCopy(
      typeof navigator !== "undefined" &&
        !!navigator.clipboard &&
        typeof navigator.clipboard.write === "function" &&
        typeof ClipboardItem !== "undefined"
    )
  }, [])

  // Held in a ref so an inline arrow from the caller doesn't re-run the capture.
  const captureRef = useRef(capture)
  captureRef.current = capture

  useEffect(() => {
    let cancelled = false
    let createdUrl: string | null = null

    async function generate() {
      try {
        await document.fonts.ready
        // Let layout/paint settle before snapshotting.
        await new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r()))
        )

        const blob = await captureRef.current()
        if (!blob) throw new Error("capture failed")
        if (cancelled) return

        blobRef.current = blob
        createdUrl = URL.createObjectURL(blob)
        setPreviewUrl(createdUrl)
        setStatus("ready")
      } catch {
        if (!cancelled) setStatus("error")
      }
    }

    generate()
    return () => {
      cancelled = true
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
  }, [])

  const flash = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 1800)
  }, [])

  function save() {
    const blob = blobRef.current
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    flash("saved")
  }

  async function share() {
    const blob = blobRef.current
    if (!blob) return
    const file = new File([blob], fileName, { type: "image/png" })
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "best workout tracker" })
      } else {
        save()
      }
    } catch {
      // user cancelled or share failed — no-op
    }
  }

  async function copy() {
    const blob = blobRef.current
    if (!blob) return
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])
      flash("copied")
    } catch {
      save()
    }
  }

  const btnBase =
    "flex-1 py-4 rounded-2xl text-[15px] font-semibold active:scale-[0.97] transition-all disabled:opacity-30"

  return (
    <div
      role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex flex-col bg-zinc-950 animate-slide-up"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <EscapeKey onEscape={onClose} />
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <p className="text-zinc-500 text-[11px] uppercase tracking-[0.18em] font-semibold">
          {title}
        </p>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-300 text-sm font-medium transition-colors px-1"
        >
          close
        </button>
      </div>

      {/* Preview */}
      <div className="flex-1 flex items-center justify-center px-5 pb-3 min-h-0">
        {status === "loading" && (
          <div className="flex flex-col items-center gap-3 text-zinc-500">
            <div className="w-8 h-8 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
            <span className="text-sm tracking-wide">building your card…</span>
          </div>
        )}
        {status === "error" && (
          <p className="text-zinc-500 text-sm text-center max-w-[260px] leading-relaxed">
            couldn&apos;t build the image. try again.
          </p>
        )}
        {status === "ready" && previewUrl && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={previewUrl}
            alt={alt}
            className="max-h-full max-w-full rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.6)] object-contain animate-fade-up"
          />
        )}
      </div>

      {/* Actions */}
      <div
        className="px-5 pt-2"
        style={{ paddingBottom: "calc(1.75rem + env(safe-area-inset-bottom))" }}
      >
        <div className="flex gap-2">
          {canShare && (
            <button
              onClick={share}
              disabled={status !== "ready"}
              className={`${btnBase} bg-white text-zinc-900 hover:bg-zinc-100`}
            >
              share
            </button>
          )}
          <button
            onClick={save}
            disabled={status !== "ready"}
            className={`${btnBase} bg-zinc-800 text-white hover:bg-zinc-700`}
          >
            save
          </button>
          {canCopy && (
            <button
              onClick={copy}
              disabled={status !== "ready"}
              className={`${btnBase} bg-zinc-800 text-white hover:bg-zinc-700`}
            >
              copy
            </button>
          )}
        </div>
        {toast && (
          <p className="text-center text-zinc-400 text-sm mt-3 animate-fade-in">{toast}</p>
        )}
      </div>
    </div>
  )
}
