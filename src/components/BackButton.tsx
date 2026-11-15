"use client"

import Link from "next/link"

interface BackButtonProps {
  /** Where back leads. Give this or onClick. */
  href?: string
  onClick?: () => void
  /** What a screen reader announces, e.g. "Back to routine". */
  label?: string
  disabled?: boolean
  className?: string
}

/**
 * The one back control every page uses: a chevron in a 40px target, hung 10px into the
 * page margin so the glyph itself lines up with the content below it.
 */
export default function BackButton({ href, onClick, label = "Back", disabled, className = "" }: BackButtonProps) {
  const classes = `inline-flex w-10 h-10 -ml-2.5 items-center justify-center rounded-full text-ink-4 hover:text-ink active:bg-surface-2 transition-colors shrink-0 disabled:opacity-40 ${className}`
  const icon = (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="11,4 6,9 11,14" />
    </svg>
  )
  if (href) {
    return (
      <Link href={href} aria-label={label} className={classes}>
        {icon}
      </Link>
    )
  }
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} className={classes}>
      {icon}
    </button>
  )
}
