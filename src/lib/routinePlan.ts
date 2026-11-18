import {
  MuscleGroupConfig,
  ExerciseConfig,
  generateId,
  getDefaultSets,
  isCardioGroup,
  retireReplacedGroups,
} from "./exerciseConfig"
import { TrainingDay } from "./types"
import { RoutineBundle, buildRoutineBundle } from "./routines"

/**
 * Routine plans: a routine written as JSON for something outside the app to edit.
 *
 * A plan is what an LLM reads and writes, whether that is Dot's planner on the server
 * or the user's own chatbot via copy and paste. It is deliberately smaller than the
 * stored routine: no orders (array position is the order) and no exercise ids, since
 * those are ours to keep. Group and day ids travel so an edited plan can say "this is
 * still your Chest", which is what keeps a group's history attached to it.
 *
 * The flow is the same whichever way the plan arrives:
 * `extractPlanJson` (forgiving: fences, prose, smart quotes) → `parsePlan` (strict:
 * shape, limits, references, readable errors) → `resolvePlan` (onto the user's own
 * config: ids reused, dropped groups retired, a summary of what changes).
 *
 * Imported by both the plan page and the plan route, so it stays free of
 * `server-only` imports.
 */

export const PLAN_VERSION = 1

export interface PlanExercise {
  name: string
  /** Working sets the logger opens with. */
  sets?: number
}

export interface PlanGroup {
  /** The id of a group the user already has. Absent, or unknown, means a new group. */
  id?: string
  name: string
  exercises: PlanExercise[]
}

export interface PlanDay {
  id?: string
  name: string
  /** Each entry is a group's id or its name, from this plan's `groups`. */
  groups: string[]
}

export interface RoutinePlan {
  version: number
  groups: PlanGroup[]
  days: PlanDay[]
}

// Generous for any real split, small enough that a runaway reply can't bloat a config.
export const PLAN_LIMITS = {
  days: 7,
  groups: 20,
  exercisesPerGroup: 12,
  exercises: 120,
  groupsPerDay: 10,
  name: 40,
  sets: { min: 1, max: 10 },
} as const

/** How many problems to report at once. Past this the plan is simply not close. */
const MAX_ERRORS = 8

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v)
}

/** The user's routine as a plan, ready to hand to an LLM. */
export function exportPlan(config: MuscleGroupConfig[], days: TrainingDay[]): RoutinePlan {
  const bundle = buildRoutineBundle(config, days)
  return {
    version: PLAN_VERSION,
    groups: bundle.muscleGroups.map((g) => ({
      id: g.id,
      name: g.name,
      exercises: g.exercises.map((e) => ({ name: e.name, sets: e.defaultSets ?? getDefaultSets(e) })),
    })),
    days: bundle.trainingDays.map((d) => ({ id: d.id, name: d.name, groups: d.muscleGroupIds })),
  }
}

// ─── Extract ──────────────────────────────────────────────────────────────────

/**
 * Pull the plan's JSON out of whatever was pasted: a bare object, a ```json fence, an
 * object with chatter around it, or a whole conversation — the copy prompt (which holds
 * an example and the current routine) followed by the model's reply.
 *
 * Every fenced block and every balanced top-level `{…}` span is a candidate, and the
 * last one that reads as a plan wins: in a conversation the reply comes last, and a
 * fragment quoted in prose ("shaped like {"groups": …}") never reads as one. Each
 * candidate gets one repair pass for the damage a phone's clipboard and a chatty model
 * do most — curly quotes and trailing commas. When none is a plan, the value handed on
 * is the most plan-like that parsed, so `parsePlan` can say what is wrong with it.
 */
export function extractPlanJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, error: "Nothing was pasted." }

  const candidates = [...fencedBlocks(trimmed), ...objectSpans(trimmed)]
  if (candidates.length === 0) {
    return { ok: false, error: "There's no JSON in that. Paste the reply that starts with { and ends with }." }
  }

  let best: { value: unknown; planLike: boolean } | null = null
  for (let i = candidates.length - 1; i >= 0; i--) {
    const parsed = parseLoosely(candidates[i])
    if (!parsed) continue
    if (parsePlan(parsed.value).ok) return { ok: true, value: parsed.value }
    const planLike = looksLikePlan(parsed.value)
    if (!best || (planLike && !best.planLike)) best = { value: parsed.value, planLike }
  }
  if (best) return { ok: true, value: best.value }
  return {
    ok: false,
    error: "That JSON doesn't parse. It may have been cut off — copy the whole reply and try again.",
  }
}

function parseLoosely(raw: string): { value: unknown } | null {
  for (const attempt of [raw, repairJson(raw)]) {
    try {
      return { value: JSON.parse(attempt) }
    } catch {
      // try the repaired text
    }
  }
  return null
}

function looksLikePlan(v: unknown): boolean {
  return isObject(v) && ["groups", "days", "muscleGroups", "trainingDays", "plan", "routine"].some((k) => k in v)
}

/**
 * The contents of each fenced block that holds a `{`. A fence opens and closes only at
 * the start of a line, so a ``` mentioned mid-sentence ("send it as a ```json block")
 * doesn't pair up with the real one. A fence still open at the end — a reply cut off
 * mid-stream — runs to the end of the text.
 */
function fencedBlocks(text: string): string[] {
  const blocks: string[] = []
  let open: string[] | null = null
  for (const line of text.split("\n")) {
    const isFence = /^\s*```/.test(line)
    if (open === null) {
      if (isFence) open = []
    } else if (isFence) {
      blocks.push(open.join("\n"))
      open = null
    } else {
      open.push(line)
    }
  }
  if (open) blocks.push(open.join("\n"))
  return blocks.filter((b) => b.includes("{"))
}

/**
 * Each top-level `{…}` span, matching braces outside JSON strings. Quotes only count
 * inside a span (prose has apostrophes and stray quotes of its own), and a string ends
 * at a line break, since JSON strings cannot hold one — so an unbalanced quote costs one
 * line rather than the rest of the text. A span still open at the end is kept as it is,
 * so a reply cut off mid-stream reads as JSON that doesn't parse. One pass, so a long
 * paste costs no more than its length.
 */
function objectSpans(text: string): string[] {
  const spans: string[] = []
  let depth = 0
  let start = 0
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (depth === 0) {
      if (c === "{") {
        depth = 1
        start = i
      }
      continue
    }
    if (inString) {
      if (escaped) escaped = false
      else if (c === "\\") escaped = true
      else if (c === '"' || c === "\n") inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === "{") depth++
    else if (c === "}" && --depth === 0) spans.push(text.slice(start, i + 1))
  }
  if (depth > 0) spans.push(text.slice(start))
  return spans
}

function repairJson(raw: string): string {
  return raw
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/,\s*([}\]])/g, "$1")
}

// ─── Parse ────────────────────────────────────────────────────────────────────

export type ParseResult =
  | { ok: true; plan: RoutinePlan; warnings: string[] }
  | { ok: false; errors: string[] }

function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null
  const name = v.replace(/\s+/g, " ").trim()
  return name && name.length <= PLAN_LIMITS.name ? name : null
}

function cleanId(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() && v.length <= 80 ? v.trim() : undefined
}

/**
 * Check a plan's shape and limits, and that every day only names groups the plan has.
 *
 * Also takes the stored routine's own field names (`muscleGroups`, `trainingDays`,
 * `muscleGroupIds`, `defaultSets`), since a model shown one may answer in the other.
 * Errors are written to be pasted straight back to the model that made the plan.
 */
export function parsePlan(input: unknown): ParseResult {
  const errors: string[] = []
  const warnings: string[] = []
  const fail = (msg: string) => {
    if (errors.length < MAX_ERRORS) errors.push(msg)
  }

  let doc = input
  // A reply wrapped one level deep, as { "plan": { ... } }.
  if (isObject(doc) && !("groups" in doc) && !("muscleGroups" in doc)) {
    const inner = doc.plan ?? doc.routine
    if (isObject(inner)) doc = inner
  }
  if (!isObject(doc)) return { ok: false, errors: ["The plan must be a JSON object with \"groups\" and \"days\"."] }

  if (typeof doc.version === "number" && doc.version > PLAN_VERSION) {
    return { ok: false, errors: [`This plan is format version ${doc.version}; this app reads version ${PLAN_VERSION}.`] }
  }

  const rawGroups = doc.groups ?? doc.muscleGroups
  const rawDays = doc.days ?? doc.trainingDays
  if (!Array.isArray(rawGroups) || rawGroups.length === 0) {
    return { ok: false, errors: ["\"groups\" must be a non-empty list of muscle groups."] }
  }
  if (!Array.isArray(rawDays) || rawDays.length === 0) {
    return { ok: false, errors: ["\"days\" must be a non-empty list of training days."] }
  }
  if (rawGroups.length > PLAN_LIMITS.groups) fail(`At most ${PLAN_LIMITS.groups} muscle groups, not ${rawGroups.length}.`)
  if (rawDays.length > PLAN_LIMITS.days) fail(`At most ${PLAN_LIMITS.days} training days, not ${rawDays.length}.`)
  if (errors.length) return { ok: false, errors }

  const groups: PlanGroup[] = []
  const groupKeys = new Map<string, number>() // id or normalised name → index in `groups`
  let exerciseTotal = 0

  rawGroups.forEach((g, gi) => {
    const where = `Group ${gi + 1}`
    if (!isObject(g)) return fail(`${where} must be an object with a "name" and "exercises".`)
    const name = cleanName(g.name)
    if (!name) return fail(`${where} needs a name of 1–${PLAN_LIMITS.name} characters.`)
    const id = cleanId(g.id)
    if (groupKeys.has(norm(name)) || (id && groupKeys.has(id))) {
      return fail(`There are two groups called "${name}". Merge them or give one another name.`)
    }

    const rawExercises = g.exercises ?? []
    if (!Array.isArray(rawExercises)) return fail(`"${name}": "exercises" must be a list.`)
    if (rawExercises.length > PLAN_LIMITS.exercisesPerGroup) {
      return fail(`"${name}" has ${rawExercises.length} exercises; at most ${PLAN_LIMITS.exercisesPerGroup}.`)
    }

    const seen = new Set<string>()
    const exercises: PlanExercise[] = []
    for (const e of rawExercises) {
      const exName = cleanName(typeof e === "string" ? e : isObject(e) ? e.name : null)
      if (!exName) {
        fail(`"${name}" has an exercise without a usable name (1–${PLAN_LIMITS.name} characters).`)
        continue
      }
      if (seen.has(norm(exName))) {
        warnings.push(`"${exName}" was listed twice in ${name}; kept once.`)
        continue
      }
      seen.add(norm(exName))
      const rawSets = isObject(e) ? (e.sets ?? e.defaultSets) : undefined
      const ex: PlanExercise = { name: exName }
      if (typeof rawSets === "number" && Number.isFinite(rawSets)) {
        ex.sets = Math.min(PLAN_LIMITS.sets.max, Math.max(PLAN_LIMITS.sets.min, Math.round(rawSets)))
      }
      exercises.push(ex)
    }
    exerciseTotal += exercises.length
    if (exercises.length === 0) warnings.push(`${name} has no exercises yet.`)

    const index = groups.length
    groups.push(id ? { id, name, exercises } : { name, exercises })
    groupKeys.set(norm(name), index)
    if (id) groupKeys.set(id, index)
  })
  if (exerciseTotal > PLAN_LIMITS.exercises) fail(`${exerciseTotal} exercises in total; at most ${PLAN_LIMITS.exercises}.`)

  const days: PlanDay[] = []
  const dayNames = new Set<string>()
  const used = new Set<number>()

  rawDays.forEach((d, di) => {
    const where = `Day ${di + 1}`
    if (!isObject(d)) return fail(`${where} must be an object with a "name" and "groups".`)
    const name = cleanName(d.name)
    if (!name) return fail(`${where} needs a name of 1–${PLAN_LIMITS.name} characters.`)
    if (dayNames.has(norm(name))) return fail(`There are two days called "${name}". Give each day its own name.`)
    dayNames.add(norm(name))

    const refs = d.groups ?? d.muscleGroupIds ?? []
    if (!Array.isArray(refs)) return fail(`"${name}": "groups" must be a list of group names or ids.`)
    if (refs.length > PLAN_LIMITS.groupsPerDay) {
      return fail(`"${name}" trains ${refs.length} groups; at most ${PLAN_LIMITS.groupsPerDay}.`)
    }

    const picked: string[] = []
    for (const ref of refs) {
      const index = typeof ref === "string" ? (groupKeys.get(ref.trim()) ?? groupKeys.get(norm(ref))) : undefined
      if (index === undefined) {
        fail(`Day "${name}" uses ${JSON.stringify(ref)}, which isn't one of the groups. Use a group's exact name or id.`)
        continue
      }
      // Days point at groups by whichever key the plan used; settle on one.
      const key = groups[index].id ?? groups[index].name
      if (!picked.includes(key)) picked.push(key)
      used.add(index)
    }
    if (picked.length === 0 && refs.length === 0) warnings.push(`${name} has no muscle groups, so it reads as a rest day.`)

    const id = cleanId(d.id)
    days.push(id ? { id, name, groups: picked } : { name, groups: picked })
  })

  if (errors.length) return { ok: false, errors }

  groups.forEach((g, i) => {
    if (!used.has(i)) warnings.push(`${g.name} isn't on any day, so it won't come up unless you add it to one.`)
  })

  return { ok: true, plan: { version: PLAN_VERSION, groups, days }, warnings }
}

/** Extract and parse in one go, for pasted text and model replies alike. */
export function readPlanText(text: string): ParseResult {
  const extracted = extractPlanJson(text)
  if (!extracted.ok) return { ok: false, errors: [extracted.error] }
  return parsePlan(extracted.value)
}

// ─── Resolve ──────────────────────────────────────────────────────────────────

export interface PlanChanges {
  /** True when applying the plan would leave the routine exactly as it is. */
  unchanged: boolean
  groupsAdded: string[]
  /** Kept in history as retired groups, so past sessions still name them. */
  groupsRemoved: string[]
  groupsRenamed: { from: string; to: string }[]
  /** Names the user has never had anywhere in their split, so they start without history. */
  exercisesAdded: string[]
  exercisesRemoved: string[]
  daysBefore: string[]
  daysAfter: string[]
}

export interface ResolvedPlan {
  config: MuscleGroupConfig[]
  days: TrainingDay[]
  /** The new routine as the preview draws it. */
  bundle: RoutineBundle
  changes: PlanChanges
}

/**
 * Lay a parsed plan over the user's own config.
 *
 * Every group, exercise and day keeps the id it already has wherever the plan lets us
 * recognise it — by id first, then by name — because ids are what sessions, recovery
 * and the up-next card hold on to. A group the user once deleted and the plan brings
 * back by name gets its old id back, and with it its history. Groups the plan drops
 * are retired rather than deleted (the same path as training under a coach), and the
 * cardio library is left alone, since it was never part of the split.
 */
export function resolvePlan(
  plan: RoutinePlan,
  config: MuscleGroupConfig[],
  days: TrainingDay[]
): ResolvedPlan {
  const live = config.filter((g) => !g.retired && !isCardioGroup(g))
  const retired = config.filter((g) => g.retired && !isCardioGroup(g))
  const taken = new Set(config.map((g) => g.id))
  const claimed = new Set<string>()
  const byId = new Map(config.filter((g) => !isCardioGroup(g)).map((g) => [g.id, g]))
  const allExercises = new Map<string, ExerciseConfig>()
  for (const g of live) for (const e of g.exercises) allExercises.set(norm(e.name), e)

  const stamp = Date.now().toString(36)
  const newId = (name: string, fallback: string) => {
    const base = slugify(name) || fallback
    let id = base
    for (let n = 2; taken.has(id) || claimed.has(id); n++) id = `${base}-${stamp}${n > 2 ? `-${n}` : ""}`
    return id
  }

  const refToId = new Map<string, string>()
  const groups: MuscleGroupConfig[] = plan.groups.map((pg, gi) => {
    const match =
      (pg.id && byId.get(pg.id) && !claimed.has(pg.id) ? byId.get(pg.id) : undefined) ??
      live.find((g) => norm(g.name) === norm(pg.name) && !claimed.has(g.id)) ??
      retired.find((g) => norm(g.name) === norm(pg.name) && !claimed.has(g.id))
    const id = match ? match.id : newId(pg.id ?? pg.name, `group-${gi + 1}`)
    claimed.add(id)
    refToId.set(pg.id ?? pg.name, id)

    const own = new Map((match?.exercises ?? []).map((e) => [norm(e.name), e]))
    const exIds = new Set<string>()
    const exercises: ExerciseConfig[] = pg.exercises.map((pe, ei) => {
      const prev = own.get(norm(pe.name)) ?? allExercises.get(norm(pe.name))
      let exId = prev?.id ?? generateId(pe.name)
      if (exIds.has(exId)) exId = `${exId}-${ei}`
      exIds.add(exId)
      const sets = pe.sets ?? (prev ? (prev.defaultSets ?? getDefaultSets(prev)) : ei === 0 ? 3 : 2)
      return { id: exId, name: pe.name, order: ei, defaultSets: sets }
    })

    return { id, name: pg.name, order: gi, exercises }
  })

  const dayIds = new Set<string>()
  const newDays: TrainingDay[] = plan.days.map((pd, di) => {
    const match =
      (pd.id ? days.find((d) => d.id === pd.id && !dayIds.has(d.id)) : undefined) ??
      days.find((d) => norm(d.name) === norm(pd.name) && !dayIds.has(d.id))
    let id = match?.id ?? generateId(pd.name)
    if (dayIds.has(id)) id = `${id}-${di}`
    dayIds.add(id)
    return {
      id,
      name: pd.name,
      order: di,
      muscleGroupIds: pd.groups.flatMap((ref) => refToId.get(ref) ?? []),
    }
  })

  const nextConfig = retireReplacedGroups(groups, config)
  const before = buildRoutineBundle(config, days)
  const after = buildRoutineBundle(nextConfig, newDays)

  const afterExercises = new Set(after.muscleGroups.flatMap((g) => g.exercises.map((e) => norm(e.name))))
  const uniqueNames = (gs: RoutineBundle["muscleGroups"], keep: (n: string) => boolean) => {
    const out = new Map<string, string>()
    for (const g of gs) for (const e of g.exercises) if (keep(norm(e.name))) out.set(norm(e.name), e.name)
    return [...out.values()]
  }
  const knownExercises = new Set(config.flatMap((g) => g.exercises.map((e) => norm(e.name))))

  const changes: PlanChanges = {
    unchanged: JSON.stringify(stripExerciseIds(before)) === JSON.stringify(stripExerciseIds(after)),
    groupsAdded: groups.filter((g) => !byId.has(g.id)).map((g) => g.name),
    groupsRemoved: live.filter((g) => !claimed.has(g.id)).map((g) => g.name),
    groupsRenamed: groups.flatMap((g) => {
      const prev = live.find((l) => l.id === g.id)
      return prev && prev.name !== g.name ? [{ from: prev.name, to: g.name }] : []
    }),
    exercisesAdded: uniqueNames(after.muscleGroups, (n) => !knownExercises.has(n)),
    exercisesRemoved: uniqueNames(before.muscleGroups, (n) => !afterExercises.has(n)),
    daysBefore: before.trainingDays.map((d) => d.name),
    daysAfter: after.trainingDays.map((d) => d.name),
  }

  return { config: nextConfig, days: newDays, bundle: after, changes }
}

/** Exercise ids are generated fresh for new names, so they say nothing about change. */
function stripExerciseIds(bundle: RoutineBundle) {
  return {
    ...bundle,
    muscleGroups: bundle.muscleGroups.map((g) => ({
      ...g,
      exercises: g.exercises.map(({ name, order, defaultSets }) => ({ name, order, defaultSets })),
    })),
  }
}
