"use client"

import { WeightEntry } from "@/lib/types"
import { formatDay, round1 } from "@/lib/weight"
import { useConfirm } from "@/components/ConfirmSheet"

interface Props {
  /** Oldest first; rendered newest first. */
  entries: WeightEntry[]
  onEdit: (date: string) => void
  onDelete: (date: string) => void
}

export default function WeightLogList({ entries, onEdit, onDelete }: Props) {
  const { confirm, confirmSheet } = useConfirm()
  if (entries.length === 0) {
    return <p className="text-sm text-ink-6">no weigh-ins yet.</p>
  }

  const rows = [...entries].reverse()

  return (
    <>
      {confirmSheet}
    <ul className="divide-y divide-line-soft">
      {rows.map((e, i) => {
        // Change against the previous weigh-in, whenever that was.
        const prev = rows[i + 1]
        const change = prev ? round1(e.kg - prev.kg) : null
        return (
          <li key={e.date} className="flex items-center gap-3 py-2.5">
            <button
              onClick={() => onEdit(e.date)}
              className="flex-1 flex items-baseline gap-3 text-left"
            >
              <span className="text-sm text-ink-5 w-16 shrink-0">{formatDay(e.date)}</span>
              <span className="text-base font-semibold text-ink tabular-nums">
                {e.kg.toFixed(1)}
                <span className="text-xs font-normal text-ink-6 ml-0.5">kg</span>
              </span>
              {change !== null && change !== 0 && (
                <span className="text-[11px] text-ink-6 tabular-nums">
                  {change > 0 ? "+" : "−"}
                  {Math.abs(change).toFixed(1)}
                </span>
              )}
            </button>
            <button
              onClick={async () => {
                const yes = await confirm({
                  title: `Delete the weigh-in from ${formatDay(e.date)}?`,
                  confirmLabel: "Delete",
                  destructive: true,
                })
                if (yes) onDelete(e.date)
              }}
              className="text-ink-7 hover:text-bad transition-colors p-1"
              aria-label={`Delete weigh-in from ${formatDay(e.date)}`}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                <path d="M3 4h10M6.5 4V2.5h3V4M4.5 4l.5 9.5h6L11.5 4" />
              </svg>
            </button>
          </li>
        )
      })}
    </ul>
    </>
  )
}
