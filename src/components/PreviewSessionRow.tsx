"use client"

import { Prescription } from "@/lib/prescription"

interface PreviewSessionRowProps {
  label: string
  rx: Prescription
  /** Names a session that stands out, e.g. the peak single. */
  tag?: string
  /** Muted further for rows deeper in the block. */
  faint?: boolean
  /** Jump the program straight to this session. Absent where a jump makes no sense. */
  onJump?: () => void
}

/** A session that hasn't been generated yet, shown with its projected load. */
export default function PreviewSessionRow({ label, rx, tag, faint = false, onJump }: PreviewSessionRowProps) {
  const effort = rx.rpe != null ? `RPE ${rx.rpe}` : null
  const body = (
    <>
      <span className="flex flex-col gap-0.5 min-w-0">
        <span className="flex items-center gap-1.5">
          <span className={`text-xs font-medium ${faint ? "text-[#aaaaaa]" : "text-[#888888]"}`}>{label}</span>
          {rx.light && (
            <span className="text-[9px] font-semibold uppercase tracking-wide text-[#888888] bg-white rounded px-1 py-px">
              Light
            </span>
          )}
          {tag && (
            <span className="text-[9px] font-semibold uppercase tracking-wide text-[#1e3a5f] bg-[#dbeafe] rounded px-1 py-px">
              {tag}
            </span>
          )}
        </span>
        {effort && <span className="text-[10px] text-[#aaaaaa]">{effort}</span>}
      </span>
      <span className="flex items-center gap-3 shrink-0">
        <span className="text-right">
          <span className={`text-sm font-semibold tabular-nums ${faint ? "text-[#777777]" : "text-[#444444]"}`}>
            {rx.weight}kg
          </span>
          <span className="text-xs text-[#aaaaaa] tabular-nums ml-1.5">
            {rx.reps} × {rx.sets}
          </span>
        </span>
        {onJump && (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[#1e3a5f] border border-[#1e3a5f]/30 rounded-full px-2 py-0.5">
            Jump
          </span>
        )}
      </span>
    </>
  )

  const className = "w-full text-left px-4 py-2.5 rounded-xl bg-[#f5f5f5] mb-2 flex justify-between items-center gap-3"
  if (!onJump) return <div className={className}>{body}</div>
  return (
    <button onClick={onJump} className={`${className} active:opacity-70`}>
      {body}
    </button>
  )
}
