"use client"

import { useRef, useEffect, useCallback } from "react"

const ITEM_H = 44
const VISIBLE = 5
const PAD = Math.floor(VISIBLE / 2) // 2
const DRAG_THRESHOLD = 8

// Applied per-item during scroll — no React re-renders needed
function applyItemStyles(el: HTMLDivElement, spans: (HTMLSpanElement | null)[]) {
  const viewCenter = el.scrollTop + (VISIBLE * ITEM_H) / 2
  spans.forEach((span, i) => {
    if (!span) return
    const itemCenter = PAD * ITEM_H + i * ITEM_H + ITEM_H / 2
    const dist = Math.abs(viewCenter - itemCenter) / ITEM_H
    // dist=0 → normal, dist=1 → small, dist=2 → smallest
    span.style.opacity = String(Math.max(0.15, 1 - dist * 0.43))
    span.style.transform = `scale(${Math.max(0.72, 1 - dist * 0.14)})`
  })
}

interface DrumRollPickerProps {
  values: (number | null)[]
  selected: number | null
  onChange: (v: number | null) => void
  label: string
  format?: (v: number | null) => string
  disabled?: boolean
}

export function DrumRollPicker({
  values,
  selected,
  onChange,
  label,
  format,
  disabled = false,
}: DrumRollPickerProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const spanRefs = useRef<(HTMLSpanElement | null)[]>([])
  const dragRef = useRef<{ startY: number; startScrollTop: number; activated: boolean } | null>(null)

  const fmt = format ?? ((v: number | null) => (v == null ? "—" : String(v)))

  const snapAndCommit = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const idx = Math.round(el.scrollTop / ITEM_H)
    const clamped = Math.max(0, Math.min(values.length - 1, idx))
    el.scrollTop = clamped * ITEM_H
    applyItemStyles(el, spanRefs.current)
    onChange(values[clamped] ?? null)
  }, [values, onChange])

  // Set initial scroll position and apply starting styles
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const idx = values.findIndex((v) => v === selected)
    el.scrollTop = (idx === -1 ? 0 : idx) * ITEM_H
    applyItemStyles(el, spanRefs.current)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Live style updates via RAF during drag-driven scroll
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let raf: number
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => applyItemStyles(el, spanRefs.current))
    }
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      el.removeEventListener("scroll", onScroll)
      cancelAnimationFrame(raf)
    }
  }, [])

  const FADE = "linear-gradient(to bottom, transparent 0%, black 40%, black 60%, transparent 100%)"

  return (
    <div
      className="flex flex-col items-center flex-1"
      style={{ opacity: disabled ? 0.4 : 1, pointerEvents: disabled ? "none" : "auto" }}
    >
      <span className="text-[10px] text-ink-6 uppercase tracking-wide mb-2">{label}</span>
      <div
        className="relative w-full"
        style={{ height: VISIBLE * ITEM_H, touchAction: "none" }}
        onPointerDown={(e) => {
          const el = scrollRef.current
          if (!el || disabled) return
          dragRef.current = { startY: e.clientY, startScrollTop: el.scrollTop, activated: false }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const el = scrollRef.current
          if (!el || !dragRef.current) return
          const dy = dragRef.current.startY - e.clientY
          if (!dragRef.current.activated) {
            if (Math.abs(dy) < DRAG_THRESHOLD) return
            dragRef.current.activated = true
          }
          el.scrollTop = dragRef.current.startScrollTop + dy
        }}
        onPointerUp={() => {
          if (!dragRef.current) return
          const { activated, startScrollTop } = dragRef.current
          dragRef.current = null
          if (activated) {
            snapAndCommit()
          } else {
            const el = scrollRef.current
            if (el) {
              el.scrollTop = startScrollTop
              applyItemStyles(el, spanRefs.current)
            }
          }
        }}
        onPointerCancel={() => {
          dragRef.current = null
        }}
      >
        {/* Selection highlight — behind scroll content */}
        <div
          className="absolute inset-x-1 rounded-xl bg-surface-3"
          style={{ top: PAD * ITEM_H, height: ITEM_H }}
        />
        {/* Scroll list — overflow:hidden so it is not a competing scroll container */}
        <div
          ref={scrollRef}
          className="absolute inset-0 overflow-hidden"
          style={{ maskImage: FADE, WebkitMaskImage: FADE }}
        >
          <div style={{ height: PAD * ITEM_H }} aria-hidden="true" />
          {values.map((v, i) => (
            <div
              key={i}
              className="flex items-center justify-center"
              style={{ height: ITEM_H }}
            >
              <span
                ref={(el) => { spanRefs.current[i] = el }}
                className="text-xl font-semibold text-ink select-none leading-none"
                style={{ willChange: "transform, opacity", transformOrigin: "center" }}
              >
                {fmt(v)}
              </span>
            </div>
          ))}
          <div style={{ height: PAD * ITEM_H }} aria-hidden="true" />
        </div>
      </div>
    </div>
  )
}
