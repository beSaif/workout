"use client"

interface PreviewSessionRowProps {
  label: string
  prescription: string
  /** Muted further for rows deeper in the block, as the previews always were. */
  faint?: boolean
  /** Jump the program straight to this session. Absent where a jump makes no sense. */
  onJump?: () => void
}

/** A session that hasn't been generated yet, shown with its projected load. */
export default function PreviewSessionRow({ label, prescription, faint = false, onJump }: PreviewSessionRowProps) {
  const textOpacity = faint ? "opacity-40" : "opacity-50"
  const body = (
    <>
      <span className={`text-xs text-[#888888] ${textOpacity}`}>{label}</span>
      <span className="flex items-center gap-2">
        <span className={`text-xs font-semibold text-[#555555] ${textOpacity}`}>{prescription}</span>
        {onJump && (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[#1e3a5f] border border-[#1e3a5f]/30 rounded-full px-2 py-0.5">
            Jump
          </span>
        )}
      </span>
    </>
  )

  if (!onJump) {
    return <div className="px-4 py-3 rounded-xl bg-[#f5f5f5] mb-2 flex justify-between items-center">{body}</div>
  }
  return (
    <button
      onClick={onJump}
      className="w-full text-left px-4 py-3 rounded-xl bg-[#f5f5f5] mb-2 flex justify-between items-center active:opacity-70"
    >
      {body}
    </button>
  )
}
