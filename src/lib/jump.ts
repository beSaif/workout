import { BlockPhase, Session, TrainingBlock } from "./types"
import { blockPosition, createNextBlock, getBlockLength } from "./prescription"

/** A session further down the program: the slot `index` (0-based) of the `phase` block. */
export interface JumpTarget {
  phase: BlockPhase
  index: number
}

/** A full cycle is four blocks plus a possible rebuild detour; a jump never crosses more. */
const MAX_BLOCKS_CLOSED = 5

/**
 * Replace a just-completed block in the list with what follows it: the interrupted
 * block a re-acclimation was rebuilding toward, or else a fresh block of the next phase.
 */
export function closeBlock(
  blocks: TrainingBlock[],
  completed: TrainingBlock,
  confirmedSessions: Session[]
): TrainingBlock[] {
  const resumeBlock =
    completed.phase === "reacclimation" && completed.resumeBlockId !== undefined
      ? blocks.find((b) => b.id === completed.resumeBlockId)
      : undefined

  if (resumeBlock) {
    return blocks.map((b) => {
      if (b.id === completed.id) return completed
      if (b.id === resumeBlock.id) return { ...b, status: "active" as const, endDate: null }
      return b
    })
  }
  const maxBlockId = Math.max(...blocks.map((b) => b.id))
  const newBlock = createNextBlock(completed, confirmedSessions, maxBlockId + 1)
  return blocks.map((b) => (b.id === completed.id ? completed : b)).concat(newBlock)
}

/**
 * The block the active one hands over to, as it would stand the moment it takes over —
 * so its next prescribed session can be previewed and jumped to before it exists.
 */
export function peekNextBlock(
  blocks: TrainingBlock[],
  confirmedSessions: Session[]
): TrainingBlock | undefined {
  const active = blocks.find((b) => b.status === "active")
  if (!active) return undefined
  return closeBlock(blocks, skipRestOfBlock(active, null), confirmedSessions).find(
    (b) => b.status === "active"
  )
}

/** The block completed as it stands, every slot it still had marked skipped. */
function skipRestOfBlock(block: TrainingBlock, today: string | null): TrainingBlock {
  return {
    ...block,
    skippedSlots: [...(block.skippedSlots ?? []), ...range(blockPosition(block), getBlockLength(block))],
    status: "completed",
    endDate: today,
  }
}

/**
 * Move the program forward to `target` without training what lies in between. Every
 * prescribed slot passed over is recorded in its block's skippedSlots and blocks that
 * run out along the way are closed, so the target session is what prescribes next and
 * the block it sits in carries on normally from there.
 *
 * Returns null when the target isn't ahead of where the program stands.
 */
export function jumpToSession(
  blocks: TrainingBlock[],
  confirmedSessions: Session[],
  target: JumpTarget,
  today: string
): TrainingBlock[] | null {
  let current = blocks
  for (let closed = 0; closed <= MAX_BLOCKS_CLOSED; closed++) {
    const active = current.find((b) => b.status === "active")
    if (!active) return null
    const position = blockPosition(active)
    const length = getBlockLength(active)

    if (active.phase === target.phase) {
      if (target.index <= position || target.index >= length) return null
      return current.map((b) =>
        b.id === active.id
          ? { ...b, skippedSlots: [...(b.skippedSlots ?? []), ...range(position, target.index)] }
          : b
      )
    }

    current = closeBlock(current, skipRestOfBlock(active, today), confirmedSessions)

    // Landing on the first open slot of the next block skips nothing inside it.
    const next = current.find((b) => b.status === "active")
    if (next?.phase === target.phase && target.index === blockPosition(next)) return current
  }
  return null
}

function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i)
}
