import { Session } from "./types"

/**
 * Everything the gymbro card shows, derived from a friend's session history.
 *
 * All of it is computed server-side in /api/friends/profile: the raw sessions stay
 * behind the API, and only these aggregates cross to the viewer. That keeps the
 * existing privacy line (a friend never reads another friend's session list) while
 * still giving the card something to say.
 */

/**
 * How many days of history the consistency modules look at — four weeks, so the
 * grid reads as "this month" and the average it sits beside covers the same span.
 */
export const CARD_WINDOW_DAYS = 28

/**
 * How recently a record must have been set to still be badged "new". Deliberately
 * much shorter than the window: badging every PR inside eight weeks marked nearly
 * all of them, which said nothing.
 */
export const PR_FRESH_DAYS = 14

/** Rarity is earned by closing on the target, so the card visibly levels up. */
export type RarityTier = "common" | "uncommon" | "rare" | "holo"

export interface FriendPR {
  exercise: string
  kg: number
  reps: number
  /** ISO date of the session that set it. */
  date: string
  /** Set within the last PR_FRESH_DAYS — worth a shout rather than just a record. */
  isFresh: boolean
}

export interface FriendCardStats {
  /** Confirmed sessions ever logged. Doubles as the card's level. */
  level: number
  /** One entry per day for the last CARD_WINDOW_DAYS, oldest first. */
  dayDots: boolean[]
  /** Consecutive calendar weeks, counting back from this one, with a session in them. */
  weekStreak: number
  sessionsThisWeek: number
  /** Null when they have never logged a confirmed session. */
  daysSinceLast: number | null
  sessionsInWindow: number
  /** Sessions per week across the window, one decimal. */
  avgPerWeek: number
  /** Best-ever set per exercise, heaviest first. */
  records: FriendPR[]
  /** Percent of the way from 0 to their target, or null outside lift-focused mode. */
  progressPct: number | null
  rarity: RarityTier
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function daysAgo(dateStr: string, todayMs: number): number {
  return Math.round((todayMs - startOfDay(new Date(dateStr))) / 86_400_000)
}

/**
 * Rarity climbs with progress to target. Balanced-mode friends have no target to
 * chase, so they sit at uncommon rather than being stuck at the bottom tier.
 */
export function rarityFor(progressPct: number | null): RarityTier {
  if (progressPct == null) return "uncommon"
  if (progressPct >= 90) return "holo"
  if (progressPct >= 60) return "rare"
  if (progressPct >= 30) return "uncommon"
  return "common"
}

/**
 * Every working set of a session, main lift and accessories alike, tagged with the
 * exercise it belongs to. Warm-ups are excluded — a warm-up is never a record.
 */
function workingSets(
  session: Session,
  mainLiftLabel: string
): Array<{ exercise: string; kg: number; reps: number }> {
  const out = session.sets
    .filter((s) => !s.isWarmup && s.reps > 0)
    .map((s) => ({ exercise: mainLiftLabel, kg: s.kg, reps: s.reps }))

  for (const workout of session.extraWorkouts ?? []) {
    for (const exercise of workout.exercises) {
      for (const set of exercise.sets) {
        out.push({ exercise: exercise.name, kg: set.kg, reps: set.reps })
      }
    }
  }
  return out
}

/**
 * Best-ever set per exercise. Ties on weight are broken by reps, so 100kg x 5 beats
 * 100kg x 3, and the earliest session holding the best is credited with setting it.
 */
function personalRecords(
  confirmed: Session[],
  mainLiftLabel: string,
  todayMs: number,
  limit: number
): FriendPR[] {
  const best = new Map<string, FriendPR>()

  // Oldest first, so the first session to reach a weight is the one that keeps credit.
  for (const session of [...confirmed].reverse()) {
    if (!session.date) continue
    for (const set of workingSets(session, mainLiftLabel)) {
      if (set.kg <= 0) continue
      const current = best.get(set.exercise)
      if (!current || set.kg > current.kg || (set.kg === current.kg && set.reps > current.reps)) {
        best.set(set.exercise, {
          exercise: set.exercise,
          kg: set.kg,
          reps: set.reps,
          date: session.date,
          isFresh: daysAgo(session.date, todayMs) <= PR_FRESH_DAYS,
        })
      }
    }
  }

  return [...best.values()].sort((a, b) => b.kg - a.kg).slice(0, limit)
}

/**
 * Builds the card from a friend's raw sessions.
 *
 * `now` is injectable so the day grid can be tested without freezing the clock; it
 * defaults to the request time, which is what the API passes.
 */
export function buildFriendCard(
  sessions: Session[],
  opts: {
    mainLiftLabel: string
    anchor: number | null
    target: number | null
    liftFocused: boolean
    prLimit?: number
    now?: Date
  }
): FriendCardStats {
  const now = opts.now ?? new Date()
  const todayMs = startOfDay(now)

  const confirmed = sessions
    .filter((s) => s.confirmed && s.date)
    .sort((a, b) => new Date(b.date!).getTime() - new Date(a.date!).getTime())

  // A set of "days ago" values makes both the dot grid and the streak a lookup.
  const trainedDaysAgo = new Set(
    confirmed.map((s) => daysAgo(s.date!, todayMs)).filter((d) => d >= 0)
  )

  const dayDots: boolean[] = []
  for (let i = CARD_WINDOW_DAYS - 1; i >= 0; i--) dayDots.push(trainedDaysAgo.has(i))

  // Weeks run Monday-first, matching how a training week is usually planned.
  const dayOfWeek = (now.getDay() + 6) % 7
  // Days-ago -> weeks-ago. The current week holds d in [0, dayOfWeek], so the
  // offset is (6 - dayOfWeek): without it last Sunday lands in this week.
  const weekIndex = (d: number) => Math.floor((d + 6 - dayOfWeek) / 7)

  const trainedWeeks = new Set([...trainedDaysAgo].map(weekIndex))
  let weekStreak = 0
  // This week counts only once it has a session; an untrained Monday shouldn't
  // wipe a streak, so the count starts from last week when this week is empty.
  let cursor = trainedWeeks.has(0) ? 0 : 1
  while (trainedWeeks.has(cursor)) {
    weekStreak++
    cursor++
  }

  const sessionsThisWeek = [...trainedDaysAgo].filter((d) => weekIndex(d) === 0).length
  const sessionsInWindow = [...trainedDaysAgo].filter((d) => d < CARD_WINDOW_DAYS).length
  const daysSinceLast = confirmed[0]?.date
    ? Math.max(0, daysAgo(confirmed[0].date, todayMs))
    : null

  const anchor = opts.anchor ?? 0
  const target = opts.target ?? 0
  const progressPct =
    opts.liftFocused && target > 0 && anchor > 0
      ? Math.min(100, Math.round((anchor / target) * 100))
      : null

  return {
    level: confirmed.length,
    dayDots,
    weekStreak,
    sessionsThisWeek,
    daysSinceLast,
    sessionsInWindow,
    avgPerWeek: Math.round((sessionsInWindow / (CARD_WINDOW_DAYS / 7)) * 10) / 10,
    records: personalRecords(confirmed, opts.mainLiftLabel, todayMs, opts.prLimit ?? 4),
    progressPct,
    rarity: rarityFor(progressPct),
  }
}
