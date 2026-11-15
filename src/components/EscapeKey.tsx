"use client"

import { useEffect, useRef } from "react"

/**
 * Rendered inside a sheet or modal: Escape closes it, the way a keyboard or switch
 * user expects of anything marked as a dialog. Renders nothing.
 */
export default function EscapeKey({ onEscape }: { onEscape: () => void }) {
  // The latest handler without re-subscribing on every render of the parent.
  const handler = useRef(onEscape)
  useEffect(() => {
    handler.current = onEscape
  })
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") handler.current()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  return null
}
