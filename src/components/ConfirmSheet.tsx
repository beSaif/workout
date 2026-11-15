"use client"

import { ReactNode, useCallback, useEffect, useRef, useState } from "react"

export interface ConfirmOptions {
  /** The question, e.g. "Unlog Session 6?". */
  title: string
  /** What saying yes does, when the question alone doesn't say. */
  body?: string
  /** The yes button, named for the action. Defaults to "Confirm". */
  confirmLabel?: string
  cancelLabel?: string
  /** Yes removes something: the button goes red. */
  destructive?: boolean
}

interface ConfirmSheetProps extends ConfirmOptions {
  onAnswer: (yes: boolean) => void
}

/**
 * The app's own "are you sure?", in place of the browser's confirm(): a bottom sheet like
 * every other one here, with the yes button named for what it does. Escape and the
 * backdrop both answer no.
 */
export function ConfirmSheet({ title, body, confirmLabel = "Confirm", cancelLabel = "Cancel", destructive, onAnswer }: ConfirmSheetProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    // Focus starts on the safe answer, so a stray Enter never deletes anything.
    cancelRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onAnswer(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onAnswer])

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 animate-fade-in"
      onClick={() => onAnswer(false)}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={body ? "confirm-body" : undefined}
        onClick={(e) => e.stopPropagation()}
        className="bg-raised w-full max-w-[393px] rounded-t-2xl px-6 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] animate-slide-up"
      >
        <p id="confirm-title" className="text-base font-semibold text-ink mb-1">
          {title}
        </p>
        {body && (
          <p id="confirm-body" className="text-sm text-ink-4 leading-relaxed">
            {body}
          </p>
        )}
        <button
          onClick={() => onAnswer(true)}
          className={`w-full mt-6 text-white text-sm font-semibold rounded-xl py-3.5 transition-colors ${
            destructive
              ? "bg-bad-fill hover:bg-bad-fill-2 active:bg-bad-fill-3"
              : "bg-brand-fill hover:bg-brand-fill-2 active:bg-brand-fill-3"
          }`}
        >
          {confirmLabel}
        </button>
        <button
          ref={cancelRef}
          onClick={() => onAnswer(false)}
          className="w-full mt-2 text-sm font-semibold text-ink-4 rounded-xl py-3 hover:bg-surface-2 transition-colors"
        >
          {cancelLabel}
        </button>
      </div>
    </div>
  )
}

/**
 * `const { confirm, confirmSheet } = useConfirm()`: render `confirmSheet` once, then
 * `if (!(await confirm({ title: "…" }))) return` wherever window.confirm used to be.
 */
export function useConfirm(): { confirm: (options: ConfirmOptions) => Promise<boolean>; confirmSheet: ReactNode } {
  const [pending, setPending] = useState<{ options: ConfirmOptions; resolve: (yes: boolean) => void } | null>(null)

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ options, resolve })),
    []
  )

  const answer = useCallback(
    (yes: boolean) => {
      pending?.resolve(yes)
      setPending(null)
    },
    [pending]
  )

  return { confirm, confirmSheet: pending ? <ConfirmSheet {...pending.options} onAnswer={answer} /> : null }
}
