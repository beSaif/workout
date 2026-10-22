import { Session, TrainingBlock } from "./types"

/** Days off after which the bar starts feeling heavy — worth a heads-up, nothing more. */
export const LAYOFF_NUDGE_DAYS = 7
/** Days off after which real strength is likely gone and the block should restart. */
export const LAYOFF_RESTART_DAYS = 14

export type LayoffTier = "none" | "nudge" | "restart"

export interface LayoffState {
  tier: LayoffTier
  /** Whole days since the last confirmed session, midnight to midnight. */
  days: number
  lastSessionDate: string | null
}

/** Whole days between two dates, ignoring time of day. */
export function daysSinceDate(dateStr: string, now: Date = new Date()): number {
  const from = new Date(dateStr)
  if (isNaN(from.getTime())) return 0
  const fromMidnight = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime()
  const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return Math.max(0, Math.round((nowMidnight - fromMidnight) / 86_400_000))
}

function latestConfirmedDate(sessions: Session[]): string | null {
  const dates = sessions
    .filter((s) => s.confirmed && s.date)
    .map((s) => s.date!)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())
  return dates[0] ?? null
}

/**
 * How long the user has been away, bucketed into what the coach should do about it.
 * A week off costs almost nothing; two weeks off costs real strength, and following
 * a plan built before the layoff means chasing weights that are no longer there.
 */
export function getLayoffState(sessions: Session[], now: Date = new Date()): LayoffState {
  const lastSessionDate = latestConfirmedDate(sessions)
  // No training history yet — there is nothing to have lost.
  if (!lastSessionDate) return { tier: "none", days: 0, lastSessionDate: null }

  const days = daysSinceDate(lastSessionDate, now)
  const tier: LayoffTier =
    days >= LAYOFF_RESTART_DAYS ? "restart" : days >= LAYOFF_NUDGE_DAYS ? "nudge" : "none"

  return { tier, days, lastSessionDate }
}

/**
 * Restart the active block from session 1, keeping its phase and anchor weight.
 *
 * Sessions already logged in the block stay in history (their lifts, e1RMs and PRs
 * are real) but are unlinked from the block, so the block re-prescribes from its
 * first session — and so `recalibrate()`, which rebuilds sessionIds from each
 * session's blockId, doesn't silently undo the restart.
 *
 * The unconfirmed upcoming session is dropped; the caller regenerates it from the
 * restarted block.
 */
export function restartActiveBlock(
  sessions: Session[],
  blocks: TrainingBlock[]
): { sessions: Session[]; blocks: TrainingBlock[] } {
  const active = blocks.find((b) => b.status === "active")
  if (!active) return { sessions, blocks }

  const newBlocks = blocks.map((b) =>
    b.id === active.id ? { ...b, sessionIds: [], skippedSlots: undefined, startDate: null, endDate: null } : b
  )
  const newSessions = sessions
    .filter((s) => s.confirmed)
    .map((s) => (s.blockId === active.id ? { ...s, blockId: undefined } : s))

  return { sessions: newSessions, blocks: newBlocks }
}

/**
 * Wind the whole program back to session 1 of block 1 (dev tool).
 *
 * Every confirmed session stays in history — only the block bookkeeping is thrown
 * away and replaced with a single fresh accumulation block, carrying the anchor
 * currently being trained so a reset doesn't discard earned progress.
 */
export function resetToFirstBlock(
  sessions: Session[],
  blocks: TrainingBlock[]
): { sessions: Session[]; blocks: TrainingBlock[]; notes: string[] } {
  const active = blocks.find((b) => b.status === "active")
  const anchor =
    active?.anchorWeight ?? blocks[blocks.length - 1]?.anchorWeight ?? 60

  const firstBlock: TrainingBlock = {
    id: 1,
    phase: "accumulation",
    status: "active",
    sessionIds: [],
    anchorWeight: anchor,
    startDate: null,
    endDate: null,
  }

  const confirmed = sessions.filter((s) => s.confirmed)
  const newSessions = confirmed.map((s) =>
    s.blockId === undefined ? s : { ...s, blockId: undefined }
  )

  const notes = [
    `Cleared ${blocks.length} block${blocks.length === 1 ? "" : "s"} → single Accumulation block at ${anchor}kg`,
    `Kept ${confirmed.length} confirmed session${confirmed.length === 1 ? "" : "s"} in history (unlinked from blocks)`,
    "Next session prescribes as Accumulation 1/4",
  ]
  if (sessions.some((s) => !s.confirmed)) notes.push("Cleared upcoming session (regenerates on next load)")

  return { sessions: newSessions, blocks: [firstBlock], notes }
}
