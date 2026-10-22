import { Session, TrainingBlock } from "./types"
import { blockPosition, getBlockLength, prescribeForBlock } from "./prescription"
import { roundToPlate } from "./e1rm"

/** Step between consecutive rebuild loads when climbing back after an interruption. */
const REBUILD_STEP = 5

export interface RecalibrateResult {
  sessions: Session[]
  blocks: TrainingBlock[]
  /** Human-readable summary of every correction made, for the dev UI. */
  notes: string[]
}

function chrono(a: Session, b: Session): number {
  if (!a.date) return 1
  if (!b.date) return -1
  return new Date(a.date).getTime() - new Date(b.date).getTime()
}

/** Heaviest working-set weight actually logged in a session. */
function maxWorkingWeight(s: Session): number | null {
  const kgs = s.sets.filter((x) => !x.isWarmup).map((x) => x.kg)
  return kgs.length > 0 ? Math.max(...kgs) : null
}

/**
 * Repair block ↔ session bookkeeping and re-derive the active re-acclimation
 * block's rebuild loads from what was *actually* lifted, so the next prescribed
 * weight follows on from real performance instead of a stale plan.
 *
 * The upcoming (unconfirmed) session is dropped; the home screen regenerates it
 * from the corrected block state on next load.
 */
export function recalibrate(sessions: Session[], blocks: TrainingBlock[]): RecalibrateResult {
  const notes: string[] = []
  const confirmed = sessions.filter((s) => s.confirmed)

  // 1. Reconcile each block's sessionIds with the confirmed sessions that point
  //    at it, in chronological order.
  const byBlock = new Map<number, Session[]>()
  for (const s of confirmed) {
    if (s.blockId == null) continue
    const arr = byBlock.get(s.blockId) ?? []
    arr.push(s)
    byBlock.set(s.blockId, arr)
  }
  let newBlocks = blocks.map((b) => {
    const ids = (byBlock.get(b.id) ?? []).slice().sort(chrono).map((s) => s.id)
    const changed =
      ids.length !== b.sessionIds.length || ids.some((id, i) => id !== b.sessionIds[i])
    if (changed) notes.push(`Block ${b.id} (${b.phase}): sessions corrected → [${ids.join(", ")}]`)
    return { ...b, sessionIds: ids }
  })

  // 2. Recompute the active re-acclimation block's rebuild loads from real data.
  const active = newBlocks.find((b) => b.status === "active")
  if (active && active.phase === "reacclimation" && active.resumeBlockId != null) {
    const resumeBlock = newBlocks.find((b) => b.id === active.resumeBlockId)
    if (resumeBlock) {
      // The weight the interrupted block wants when it picks back up.
      const resumeWeight = prescribeForBlock(resumeBlock, blockPosition(resumeBlock)).weight

      const doneSessions = active.sessionIds
        .map((id) => confirmed.find((s) => s.id === id))
        .filter((s): s is Session => !!s)
        .sort(chrono)
      const doneWeights = doneSessions
        .map(maxWorkingWeight)
        .filter((w): w is number => w != null)

      // Climb from the last weight actually lifted, in fixed steps, up to (but
      // not reaching) the resume weight — the resume block owns that top load.
      const lastActual =
        doneWeights.length > 0
          ? doneWeights[doneWeights.length - 1]
          : active.rebuildLoads?.[0] ?? resumeWeight - REBUILD_STEP

      const future: number[] = []
      let w = roundToPlate(lastActual + REBUILD_STEP)
      while (w < resumeWeight) {
        future.push(w)
        w = roundToPlate(w + REBUILD_STEP)
      }

      // Rebuild loads = weights already lifted (kept for index alignment) + the
      // recomputed climb still to go.
      const newLoads = [...doneWeights, ...future]

      if (future.length === 0 && doneWeights.length > 0) {
        // Already caught up — finish the rebuild and reactivate the interrupted block.
        const lastDate = doneSessions[doneSessions.length - 1]?.date ?? null
        newBlocks = newBlocks.map((b) => {
          if (b.id === active.id)
            return { ...b, rebuildLoads: newLoads, status: "completed" as const, endDate: b.endDate ?? lastDate }
          if (b.id === resumeBlock.id) return { ...b, status: "active" as const, endDate: null }
          return b
        })
        notes.push(`Rebuild complete — resuming block ${resumeBlock.id} (${resumeBlock.phase}) at ${resumeWeight}kg`)
      } else if (newLoads.length > 0) {
        const prev = active.rebuildLoads ?? []
        const changed =
          newLoads.length !== prev.length || newLoads.some((x, i) => x !== prev[i])
        newBlocks = newBlocks.map((b) =>
          b.id === active.id ? { ...b, rebuildLoads: newLoads } : b
        )
        if (changed) {
          const nextTxt = future.length > 0 ? `, next ${future[0]}kg` : ""
          notes.push(`Rebuild loads recalibrated → [${newLoads.join(", ")}]${nextTxt}, resume at ${resumeWeight}kg`)
        }
      }
    }
  }

  // 3. Guarantee a single active block.
  const actives = newBlocks.filter((b) => b.status === "active")
  if (actives.length > 1) {
    const keepId = actives[actives.length - 1].id
    newBlocks = newBlocks.map((b) =>
      b.status === "active" && b.id !== keepId ? { ...b, status: "interrupted" as const } : b
    )
    notes.push(`Multiple active blocks — kept block ${keepId} active`)
  } else if (actives.length === 0 && newBlocks.length > 0) {
    const last = newBlocks[newBlocks.length - 1]
    if (blockPosition(last) < getBlockLength(last)) {
      newBlocks = newBlocks.map((b) =>
        b.id === last.id ? { ...b, status: "active" as const, endDate: null } : b
      )
      notes.push(`No active block — reactivated block ${last.id} (${last.phase})`)
    }
  }

  // 4. Drop the unconfirmed upcoming session; the home screen rebuilds it from
  //    the corrected block state.
  if (sessions.some((s) => !s.confirmed)) notes.push("Cleared upcoming session (regenerates on next load)")
  const cleanedSessions = confirmed
    .slice()
    .sort((a, b) => new Date(b.date!).getTime() - new Date(a.date!).getTime())

  if (notes.length === 0) notes.push("No inconsistencies found")

  return { sessions: cleanedSessions, blocks: newBlocks, notes }
}
