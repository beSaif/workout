import { Session, TrainingBlock, STORAGE_KEY, BLOCKS_KEY, SessionDraft, DRAFT_KEY, EXERCISES_KEY, PROFILE_KEY, PRESENCES_KEY, FRIENDS_KEY, TRAINING_DAYS_KEY, LAYOFF_DISMISS_KEY, EXERCISES_MIGRATION_KEY, WEIGHTS_KEY, WEIGH_IN_SKIP_KEY, WHATS_NEW_SEEN_KEY, PENDING_SYNC_KEY, ROUTINE_UNDO_KEY, PENDING_ONBOARDING_KEY, INSTALL_GUIDE_DISMISSED_KEY, RESUME_REQUEST_KEY, UserProfile, UserPresence, TrainingDay, WeightEntry } from "./types"
import { MuscleGroupConfig, DEFAULT_MUSCLE_GROUPS, DEFAULT_TRAINING_DAYS, EXERCISE_CONFIG_MIGRATION, migrateExerciseConfig, retireReplacedGroups } from "./exerciseConfig"
import { PersonSummary } from "./routines"
import { localSource, notifyLocalChange } from "./useLocalValue"

type StoredData = { sessions: Session[]; blocks: TrainingBlock[] }

// Every write goes through these two so components reading via useLocalValue re-render:
// the browser's own `storage` event never fires in the tab that made the change.
function writeItem(key: string, value: string): void {
  localStorage.setItem(key, value)
  notifyLocalChange()
}

function removeItem(key: string): void {
  localStorage.removeItem(key)
  notifyLocalChange()
}

/**
 * Writes to KV are fire-and-forget, so a save made offline (or while KV is down) only
 * reached localStorage. Each one is marked pending here until the server acknowledges
 * it; a load that finds its data still pending re-sends the local copy instead of
 * letting the older server copy overwrite it.
 */
type SyncTarget = "sessions" | "weights" | "exercises" | "trainingDays"

function readPending(): Partial<Record<SyncTarget, string>> {
  try {
    const raw = localStorage.getItem(PENDING_SYNC_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function writePending(map: Partial<Record<SyncTarget, string>>): void {
  try {
    if (Object.keys(map).length === 0) removeItem(PENDING_SYNC_KEY)
    else writeItem(PENDING_SYNC_KEY, JSON.stringify(map))
  } catch {
    // Private mode / quota — the write is simply not retried.
  }
}

function isPending(target: SyncTarget): boolean {
  return readPending()[target] !== undefined
}

/**
 * POST `body` and keep `target` marked pending until the server takes it. A 4xx other
 * than 401/429 means the server will never accept this payload, so retrying is
 * pointless and the server copy wins; a 401 (signed out mid-session), a 5xx or no
 * network at all leaves it pending for the next load.
 */
async function pushTracked(target: SyncTarget, url: string, body: unknown): Promise<Response | null> {
  const stamp = `${Date.now()}-${Math.random()}`
  writePending({ ...readPending(), [target]: stamp })
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const rejected = res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 429
    // Only clear our own mark: a newer save that is still in flight keeps its own.
    if (res.ok || rejected) {
      const map = readPending()
      if (map[target] === stamp) {
        delete map[target]
        writePending(map)
      }
    }
    return res
  } catch {
    return null
  }
}

export function loadSessionsLocal(): Session[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Session[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function loadBlocksLocal(): TrainingBlock[] {
  try {
    const raw = localStorage.getItem(BLOCKS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as TrainingBlock[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Whether the one-time repairs in `migrateExerciseConfig` still need to run here. */
function exerciseMigrationPending(): boolean {
  try {
    const raw = localStorage.getItem(EXERCISES_MIGRATION_KEY)
    const n = raw ? parseInt(raw, 10) : 0
    return !(Number.isFinite(n) && n >= EXERCISE_CONFIG_MIGRATION)
  } catch {
    return true
  }
}

function markExerciseMigrationDone(): void {
  try {
    writeItem(EXERCISES_MIGRATION_KEY, String(EXERCISE_CONFIG_MIGRATION))
  } catch {
    // Private mode / quota — the migration just no-ops next load, since by then the
    // config it repaired already carries the exercise it would add.
  }
}

/**
 * The config on this device. Pending migrations are applied in memory so the first
 * paint matches what `loadExerciseConfig` is about to persist; nothing is written here,
 * because this runs inside render.
 */
export function loadExerciseConfigLocal(): MuscleGroupConfig[] {
  try {
    const raw = localStorage.getItem(EXERCISES_KEY)
    if (!raw) return DEFAULT_MUSCLE_GROUPS
    const parsed = JSON.parse(raw) as MuscleGroupConfig[]
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_MUSCLE_GROUPS
    return exerciseMigrationPending() ? migrateExerciseConfig(parsed) : parsed
  } catch {
    return DEFAULT_MUSCLE_GROUPS
  }
}

export function loadProfileLocal(): UserProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as UserProfile
  } catch {
    return null
  }
}

/**
 * The cached copies above as sources for useLocalValue / useCachedState, which is how
 * a component reads them: during render, without a hydration mismatch.
 */
export const sessionsCache = localSource([STORAGE_KEY], loadSessionsLocal)
export const blocksCache = localSource([BLOCKS_KEY], loadBlocksLocal)
export const profileCache = localSource([PROFILE_KEY], loadProfileLocal)
// The migration marker changes what loadExerciseConfigLocal returns, so it is watched too.
export const exerciseConfigCache = localSource([EXERCISES_KEY, EXERCISES_MIGRATION_KEY], loadExerciseConfigLocal)
export const trainingDaysCache = localSource([TRAINING_DAYS_KEY], loadTrainingDaysLocal)
export const weightsCache = localSource([WEIGHTS_KEY], loadWeightsLocal)
export const routineSnapshotCache = localSource([ROUTINE_UNDO_KEY], loadRoutineSnapshot)

function saveLocal(sessions: Session[]): void {
  writeItem(STORAGE_KEY, JSON.stringify(sessions))
}

function saveBlocksLocal(blocks: TrainingBlock[]): void {
  writeItem(BLOCKS_KEY, JSON.stringify(blocks))
}

function saveExerciseConfigLocal(config: MuscleGroupConfig[]): void {
  writeItem(EXERCISES_KEY, JSON.stringify(config))
}

function saveProfileLocal(profile: UserProfile): void {
  writeItem(PROFILE_KEY, JSON.stringify(profile))
}

export async function loadProfile(): Promise<UserProfile | null> {
  try {
    const res = await fetch("/api/profile")
    if (res.ok) {
      const data = await res.json()
      if (data && typeof data === "object" && data.email) {
        saveProfileLocal(data)
        return data as UserProfile
      }
      return null
    }
  } catch {
    // fall through
  }
  return loadProfileLocal()
}

export async function saveProfile(profile: Omit<UserProfile, "email" | "createdAt">): Promise<UserProfile | null> {
  try {
    const res = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    })
    if (!res.ok) return null
    const data = (await res.json()) as UserProfile
    saveProfileLocal(data)
    return data
  } catch {
    return null
  }
}

export function loadTrainingDaysLocal(): TrainingDay[] {
  try {
    const raw = localStorage.getItem(TRAINING_DAYS_KEY)
    if (!raw) return DEFAULT_TRAINING_DAYS
    const parsed = JSON.parse(raw) as TrainingDay[]
    // An empty list is a choice (every day deleted), not "nothing saved".
    return Array.isArray(parsed) ? parsed : DEFAULT_TRAINING_DAYS
  } catch {
    return DEFAULT_TRAINING_DAYS
  }
}

function saveTrainingDaysLocal(days: TrainingDay[]): void {
  writeItem(TRAINING_DAYS_KEY, JSON.stringify(days))
}

/**
 * Like `loadWeights`: the route sends `null` for "never saved", so an empty array is
 * the user having deleted every day and is kept rather than replaced by the defaults.
 */
export async function loadTrainingDays(): Promise<TrainingDay[]> {
  if (isPending("trainingDays")) {
    const local = loadTrainingDaysLocal()
    await pushTracked("trainingDays", "/api/training-days", local)
    return local
  }
  try {
    const res = await fetch("/api/training-days")
    if (res.ok) {
      const data = await res.json()
      if (Array.isArray(data)) {
        saveTrainingDaysLocal(data)
        return data
      }
    }
  } catch {
    // fall through
  }
  return loadTrainingDaysLocal()
}

export function saveTrainingDays(days: TrainingDay[]): void {
  saveTrainingDaysLocal(days)
  void pushTracked("trainingDays", "/api/training-days", days)
}

export function loadWeightsLocal(): WeightEntry[] {
  try {
    const raw = localStorage.getItem(WEIGHTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as WeightEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveWeightsLocal(entries: WeightEntry[]): void {
  writeItem(WEIGHTS_KEY, JSON.stringify(entries))
}

/**
 * Load the weight log from KV, falling back to localStorage.
 *
 * Unlike `loadTrainingDays` above, an empty array from the server is accepted rather
 * than treated as "nothing there": deleting your last weigh-in on another device is a
 * legitimate state that has to propagate. The route sends `null`, not `[]`, when the
 * key has never been written, which is what the fallback below keys off.
 */
export async function loadWeights(): Promise<WeightEntry[]> {
  if (isPending("weights")) {
    const local = loadWeightsLocal()
    await pushTracked("weights", "/api/weights", local)
    return local
  }
  try {
    const res = await fetch("/api/weights")
    if (res.ok) {
      const data = await res.json()
      if (Array.isArray(data)) {
        saveWeightsLocal(data)
        return data
      }
    }
  } catch {
    // fall through
  }
  return loadWeightsLocal()
}

/**
 * "skip this week" on the check-in prompt, so it stops nagging without switching the
 * feature off. Stores the day it was skipped; `weighInDue` keeps the prompt quiet for a
 * week from then, so it expires by itself — the same trick `loadLayoffDismissLocal` uses to make a dismissal stick but not stick
 * forever. Device-local on purpose: skipping on your phone shouldn't skip on your laptop.
 */
export function loadWeighInSkipLocal(): string | null {
  try {
    return localStorage.getItem(WEIGH_IN_SKIP_KEY)
  } catch {
    return null
  }
}

export function saveWeighInSkipLocal(day: string): void {
  try {
    writeItem(WEIGH_IN_SKIP_KEY, day)
  } catch {
    // Private mode / quota — the prompt just reappears on the next load.
  }
}

/**
 * Save the weight log to localStorage (sync) and KV (async, best-effort) — the same
 * guarantee `saveAll` gives sessions, so a check-in in a basement gym still sticks.
 *
 * The server pins `profile.bw` to the newest reading; mirror that into the cached
 * profile here so /profile and the share card show the new number straight away
 * instead of waiting for the next KV round trip.
 */
export function saveWeights(entries: WeightEntry[]): void {
  saveWeightsLocal(entries)

  const newest = entries[entries.length - 1]
  if (newest) {
    const profile = loadProfileLocal()
    if (profile && profile.bw !== newest.kg) {
      try {
        saveProfileLocal({ ...profile, bw: newest.kg })
      } catch {
        // Private mode / quota — KV still has it, and the next load re-syncs.
      }
    }
  }

  void pushTracked("weights", "/api/weights", entries)
}

/**
 * Wipe all per-user local data — call on sign out. Device preferences (Dot, haptics,
 * the dismissed install guide) belong to the phone, not the account, and stay.
 */
export function wipeLocalUserData(): void {
  for (const key of [
    STORAGE_KEY,
    BLOCKS_KEY,
    EXERCISES_KEY,
    PROFILE_KEY,
    DRAFT_KEY,
    TRAINING_DAYS_KEY,
    LAYOFF_DISMISS_KEY,
    WEIGHTS_KEY,
    WEIGH_IN_SKIP_KEY,
    MINI_PLAYER_KEY,
    PRESENCES_KEY,
    FRIENDS_KEY,
    FRIEND_LAST_ACTIVE_KEY,
    WHATS_NEW_SEEN_KEY,
    PENDING_SYNC_KEY,
    ROUTINE_UNDO_KEY,
    // Name and lifts typed before sign-in; consumed straight after it, so normally gone.
    PENDING_ONBOARDING_KEY,
  ]) {
    localStorage.removeItem(key)
  }
  notifyLocalChange()
}

/**
 * The layoff banner the user last dismissed, as "<last session date>:<tier>", so a
 * dismissal sticks across reloads but a fresh layoff — or one that escalates from a
 * nudge to a restart suggestion — surfaces again.
 */
export function loadLayoffDismissLocal(): string | null {
  try {
    return localStorage.getItem(LAYOFF_DISMISS_KEY)
  } catch {
    return null
  }
}

export function saveLayoffDismissLocal(key: string): void {
  try {
    writeItem(LAYOFF_DISMISS_KEY, key)
  } catch {
    // Private mode / quota — the banner just reappears next load.
  }
}

/** Load sessions + blocks from KV, falling back to localStorage. */
export async function loadAll(): Promise<StoredData> {
  if (isPending("sessions")) {
    const local = { sessions: loadSessionsLocal(), blocks: loadBlocksLocal() }
    await pushTracked("sessions", "/api/sessions", local)
    return local
  }
  try {
    const res = await fetch("/api/sessions")
    if (res.ok) {
      const data = await res.json()
      if (data && typeof data === "object" && !Array.isArray(data) && Array.isArray(data.sessions)) {
        saveLocal(data.sessions)
        saveBlocksLocal(data.blocks ?? [])
        return { sessions: data.sessions, blocks: data.blocks ?? [] }
      }
      // Legacy format: plain array of sessions
      if (Array.isArray(data) && data.length > 0) {
        saveLocal(data)
        return { sessions: data, blocks: [] }
      }
    }
  } catch {
    // Network/KV unavailable — fall through to localStorage
  }

  return {
    sessions: loadSessionsLocal(),
    blocks: loadBlocksLocal(),
  }
}

/** Load exercise config from KV, falling back to localStorage. */
export async function loadExerciseConfig(): Promise<MuscleGroupConfig[]> {
  if (isPending("exercises")) {
    const local = loadExerciseConfigLocal()
    return pushExerciseConfig(local).catch(() => local)
  }
  let stored: MuscleGroupConfig[] | null = null
  try {
    const res = await fetch("/api/exercises")
    if (res.ok) {
      const data = await res.json()
      if (Array.isArray(data) && data.length > 0) stored = data as MuscleGroupConfig[]
    }
  } catch {
    // fall through
  }
  if (!stored) return loadExerciseConfigLocal()

  const config = exerciseMigrationPending() ? migrateExerciseConfig(stored) : stored
  // A changed reference means the migration had something to add; write it through so
  // it is not redone. Either way it is now spent — from here the config is the user's.
  markExerciseMigrationDone()
  if (config === stored) {
    saveExerciseConfigLocal(config)
    return config
  }
  saveExerciseConfigLocal(config)
  // Awaited, not fire-and-forget: for an athlete the server may refuse part of the
  // repair (a coach's Chest is the coach's), and the screen should show what it kept.
  return pushExerciseConfig(config).catch(() => config)
}

/** Who this account trains under, or null. Null too when offline — nothing is cached. */
export async function loadCoach(): Promise<PersonSummary | null> {
  try {
    const res = await fetch("/api/coach")
    if (!res.ok) return null
    const data = await res.json()
    return data && typeof data === "object" && data.email ? (data as PersonSummary) : null
  } catch {
    return null
  }
}

/**
 * Train under someone. Their routine replaces this account's groups and days and
 * stays linked; the server has already synced it, so this only mirrors the result
 * onto the device. Groups the routine drops are kept, retired, so history still
 * names them; training mode, main lift, anchor, target and sessions are untouched.
 */
export async function trainUnder(email: string): Promise<
  { ok: true; coach: PersonSummary } | { ok: false; error: string }
> {
  try {
    const res = await fetch("/api/coach", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data) return { ok: false, error: data?.error ?? "failed" }
    saveExerciseConfigLocal(data.config)
    saveTrainingDaysLocal(data.trainingDays)
    return { ok: true, coach: data.coach as PersonSummary }
  } catch {
    return { ok: false, error: "offline" }
  }
}

/** Stop training under your coach. Their routine, as it stands, becomes your own. */
export async function stopTrainingUnderCoach(): Promise<boolean> {
  try {
    const res = await fetch("/api/coach", { method: "DELETE" })
    return res.ok
  } catch {
    return false
  }
}

/** Save exercise config to localStorage (sync) and KV (async, best-effort). */
export function saveExerciseConfig(config: MuscleGroupConfig[]): void {
  saveExerciseConfigLocal(config)
  pushExerciseConfig(config).catch(() => {})
}

/**
 * Send a config to KV and return what was kept. That is the config itself, unless the
 * account trains under a coach: then the coach's groups win and only the cardio
 * library is the athlete's, so the server answers with the merged result and this
 * device takes it over.
 */
async function pushExerciseConfig(config: MuscleGroupConfig[]): Promise<MuscleGroupConfig[]> {
  const res = await pushTracked("exercises", "/api/exercises", config)
  const data = res?.ok ? await res.json().catch(() => null) : null
  if (data?.following && Array.isArray(data.config)) {
    saveExerciseConfigLocal(data.config)
    return data.config as MuscleGroupConfig[]
  }
  return config
}

/** How long "undo" is offered after a plan is applied. Past this the old routine is history. */
const ROUTINE_UNDO_DAYS = 7

export interface RoutineSnapshot {
  config: MuscleGroupConfig[]
  days: TrainingDay[]
  savedAt: string
}

/**
 * Replace the routine with a plan's, keeping what it replaced so it can be undone.
 * Only one step back is kept: applying a second plan makes the first the undo point.
 */
export function applyRoutinePlan(
  next: { config: MuscleGroupConfig[]; days: TrainingDay[] },
  previous: { config: MuscleGroupConfig[]; days: TrainingDay[] }
): void {
  const snapshot: RoutineSnapshot = { ...previous, savedAt: new Date().toISOString() }
  try {
    writeItem(ROUTINE_UNDO_KEY, JSON.stringify(snapshot))
  } catch {
    // Private mode / quota: the plan still applies, there is just no undo.
  }
  saveExerciseConfig(next.config)
  saveTrainingDays(next.days)
}

export function loadRoutineSnapshot(): RoutineSnapshot | null {
  try {
    const raw = localStorage.getItem(ROUTINE_UNDO_KEY)
    const snap = raw ? (JSON.parse(raw) as RoutineSnapshot) : null
    if (!snap || !Array.isArray(snap.config) || !Array.isArray(snap.days)) return null
    const age = Date.now() - new Date(snap.savedAt).getTime()
    return age >= 0 && age < ROUTINE_UNDO_DAYS * 86_400_000 ? snap : null
  } catch {
    return null
  }
}

export function clearRoutineSnapshot(): void {
  try {
    removeItem(ROUTINE_UNDO_KEY)
  } catch {
    // nothing to clear
  }
}

/**
 * Put the routine back to how it was before the last plan. Groups the plan added are
 * retired rather than dropped, since sessions logged since may name them.
 */
export function undoRoutinePlan(current: MuscleGroupConfig[]): { config: MuscleGroupConfig[]; days: TrainingDay[] } | null {
  const snap = loadRoutineSnapshot()
  if (!snap) return null
  const config = retireReplacedGroups(snap.config, current)
  saveExerciseConfig(config)
  saveTrainingDays(snap.days)
  clearRoutineSnapshot()
  return { config, days: snap.days }
}

/** Save sessions + blocks to localStorage (sync) and KV (async, best-effort). */
export function saveAll(sessions: Session[], blocks: TrainingBlock[]): void {
  saveLocal(sessions)
  saveBlocksLocal(blocks)
  void pushTracked("sessions", "/api/sessions", { sessions, blocks })
}

export function saveDraft(draft: SessionDraft): void {
  writeItem(DRAFT_KEY, JSON.stringify(draft))
}

export function loadDraft(): SessionDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    return JSON.parse(raw) as SessionDraft
  } catch {
    return null
  }
}

export function clearDraft(): void {
  removeItem(DRAFT_KEY)
}

export function loadPresencesLocal(): UserPresence[] {
  try {
    const raw = localStorage.getItem(PRESENCES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as UserPresence[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function savePresencesLocal(presences: UserPresence[]): void {
  writeItem(PRESENCES_KEY, JSON.stringify(presences))
}

export function loadFriendEmailsLocal(): string[] {
  try {
    const raw = localStorage.getItem(FRIENDS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as string[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveFriendEmailsLocal(emails: string[]): void {
  writeItem(FRIENDS_KEY, JSON.stringify(emails))
}

const FRIEND_LAST_ACTIVE_KEY = "bench_friend_last_active"

export function loadFriendLastActiveLocal(): Record<string, string> {
  try {
    const raw = localStorage.getItem(FRIEND_LAST_ACTIVE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

export function saveFriendLastActiveLocal(dates: Record<string, string>): void {
  writeItem(FRIEND_LAST_ACTIVE_KEY, JSON.stringify(dates))
}

const MINI_PLAYER_KEY = 'lift-tracker-mini-player'

export interface MiniPlayerState {
  sessionId: string | number
  label: string
  setsCompleted: number
  totalSets: number
  restEndTime: number | null
}

export function saveMiniPlayer(state: MiniPlayerState): void {
  writeItem(MINI_PLAYER_KEY, JSON.stringify(state))
}

export function loadMiniPlayer(): MiniPlayerState | null {
  try {
    const raw = localStorage.getItem(MINI_PLAYER_KEY)
    if (!raw) return null
    return JSON.parse(raw) as MiniPlayerState
  } catch {
    return null
  }
}

export function clearMiniPlayer(): void {
  removeItem(MINI_PLAYER_KEY)
}

/** Drop the cached sessions and blocks, leaving KV alone. A /dev tool. */
export function clearSessionsLocal(): void {
  removeItem(STORAGE_KEY)
  removeItem(BLOCKS_KEY)
}

/** Whether the add-to-home-screen guide was dismissed on this device. */
export function loadInstallGuideDismissed(): boolean {
  try {
    return !!localStorage.getItem(INSTALL_GUIDE_DISMISSED_KEY)
  } catch {
    return false
  }
}

export function saveInstallGuideDismissed(): void {
  try {
    writeItem(INSTALL_GUIDE_DISMISSED_KEY, "1")
  } catch {
    // Private mode / quota — the guide just offers itself again next time.
  }
}

/**
 * Onboarding answers typed before Google sign-in, which leaves the page. They are kept
 * here across the redirect and read back once, on the way in.
 */
export function savePendingOnboarding(pending: unknown): void {
  writeItem(PENDING_ONBOARDING_KEY, JSON.stringify(pending))
}

/** The stashed answers, removed as they are read. Null when there are none or they don't parse. */
export function takePendingOnboarding<T>(): T | null {
  const raw = localStorage.getItem(PENDING_ONBOARDING_KEY)
  if (!raw) return null
  removeItem(PENDING_ONBOARDING_KEY)
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

// The mini player's "reopen this session" hand-off to Home. Per tab (sessionStorage),
// read once: the event covers a mounted Home, this covers navigating to it.

export function saveResumeRequest(sessionId: string): void {
  try {
    sessionStorage.setItem(RESUME_REQUEST_KEY, sessionId)
  } catch {}
}

/** The requested session id, removed as it is read. */
export function takeResumeRequest(): string | null {
  try {
    const id = sessionStorage.getItem(RESUME_REQUEST_KEY)
    if (id) sessionStorage.removeItem(RESUME_REQUEST_KEY)
    return id
  } catch {
    return null
  }
}
