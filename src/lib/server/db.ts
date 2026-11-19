import "server-only"
import { kv } from "@vercel/kv"
import { Session, TrainingBlock, UserProfile } from "@/lib/types"
import { profileKey, sessionsKey, LEGACY_SESSIONS_KEY } from "@/lib/userKeys"
import { parseSessionsPayload } from "@/lib/validate"

/**
 * The one module that talks to Vercel KV. Everything server side reads and writes
 * through here (an ESLint rule keeps it that way), so the quirks of what is stored —
 * above all the two shapes of the sessions document — are handled in one place.
 *
 * Key builders stay in `@/lib/userKeys`; import them alongside this.
 */

// ---------------------------------------------------------------------------
// The sessions document
// ---------------------------------------------------------------------------

/** A user's sessions document, as the client syncs it. */
export interface SessionsDoc {
  sessions: Session[]
  blocks: TrainingBlock[]
}

/** What was found under a sessions key. See `readSessionsDoc`. */
export interface StoredSessionsDoc {
  /**
   * Exactly what is stored, with the legacy bare `Session[]` shape wrapped as
   * `{ sessions, blocks: [] }`. Not validated.
   */
  stored: unknown
  /** The same document if it passes validation, otherwise null. */
  valid: SessionsDoc | null
}

const EMPTY_SESSIONS_DOC: SessionsDoc = { sessions: [], blocks: [] }

/**
 * Normalise a raw sessions value. Falsy means nothing is stored: that is how the
 * sessions route has always told "never synced" apart.
 */
export function toStoredSessionsDoc(raw: unknown): StoredSessionsDoc | null {
  if (!raw) return null
  return {
    stored: Array.isArray(raw) ? { sessions: raw, blocks: [] } : raw,
    valid: parseSessionsPayload(raw),
  }
}

/**
 * A user's OWN sessions document, for handing back to its owner or copying, or null
 * when nothing is stored.
 *
 * Data safety: the client reads a null `GET /api/sessions` as "never synced" and
 * uploads its local copy over the server's. So a document that is stored but fails
 * validation must never come back as missing or empty, or it would be overwritten:
 * serve `stored`, which is what is there, and use `valid` only to read from it.
 */
export async function readSessionsDoc(email: string): Promise<StoredSessionsDoc | null> {
  return toStoredSessionsDoc(await kv.get(sessionsKey(email)))
}

/**
 * Someone's sessions for read-only use (friends' cards, the reminder job). A
 * malformed document reads as empty: nothing here writes it back, so there is no
 * data to lose, and the callers can then trust the types.
 */
export async function readValidSessionsDoc(email: string): Promise<SessionsDoc> {
  return toStoredSessionsDoc(await kv.get(sessionsKey(email)))?.valid ?? EMPTY_SESSIONS_DOC
}

/** `readValidSessionsDoc` for many users in one round trip, in the order given. */
export async function readValidSessionsDocs(emails: string[]): Promise<SessionsDoc[]> {
  if (emails.length === 0) return []
  const raws = await kv.mget<unknown[]>(...emails.map(sessionsKey))
  return raws.map((raw) => toStoredSessionsDoc(raw)?.valid ?? EMPTY_SESSIONS_DOC)
}

export async function writeSessionsDoc(email: string, doc: SessionsDoc): Promise<void> {
  await kv.set(sessionsKey(email), doc)
}

/**
 * Copy a document read with `readSessionsDoc` (or `readLegacySessionsDoc`) to a
 * user's sessions key unchanged, valid or not, so a copy never loses data.
 */
export async function copySessionsDoc(email: string, doc: StoredSessionsDoc): Promise<void> {
  await kv.set(sessionsKey(email), doc.stored)
}

/** The pre-accounts, single-user sessions document. Same rules as `readSessionsDoc`. */
export async function readLegacySessionsDoc(): Promise<StoredSessionsDoc | null> {
  return toStoredSessionsDoc(await kv.get(LEGACY_SESSIONS_KEY))
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export async function readProfile(email: string): Promise<UserProfile | null> {
  return kv.get<UserProfile>(profileKey(email))
}

/** Profiles for many users in one round trip, in the order given; null where absent. */
export async function readProfiles(emails: string[]): Promise<(UserProfile | null)[]> {
  if (emails.length === 0) return []
  return kv.mget<(UserProfile | null)[]>(...emails.map(profileKey))
}

export async function writeProfile(email: string, profile: UserProfile): Promise<void> {
  await kv.set(profileKey(email), profile)
}

// ---------------------------------------------------------------------------
// Everything else: a thin pass-through to the KV commands the app uses. Add a
// typed helper above instead when a document needs normalising or validating.
// ---------------------------------------------------------------------------

type SetOptions = Parameters<typeof kv.set>[2]

export const store = {
  get: <T>(key: string) => kv.get<T>(key),
  mget: <T extends unknown[]>(...keys: string[]) => kv.mget<T>(...keys),
  set: <T>(key: string, value: T, opts?: SetOptions) => kv.set(key, value, opts),
  del: (...keys: string[]) => kv.del(...keys),
  keys: (pattern: string) => kv.keys(pattern),
  expire: (key: string, seconds: number) => kv.expire(key, seconds),
  incr: (key: string) => kv.incr(key),
  decr: (key: string) => kv.decr(key),
  smembers: (key: string) => kv.smembers(key),
  sismember: (key: string, member: string) => kv.sismember(key, member),
  sadd: (key: string, member: string) => kv.sadd(key, member),
  srem: (key: string, member: string) => kv.srem(key, member),
  scard: (key: string) => kv.scard(key),
  hset: (key: string, values: Record<string, string>) => kv.hset(key, values),
  hdel: (key: string, field: string) => kv.hdel(key, field),
  hgetall: <T extends Record<string, unknown>>(key: string) => kv.hgetall<T>(key),
  lrange: (key: string, start: number, end: number) => kv.lrange(key, start, end),
  rpush: (key: string, ...values: string[]) => kv.rpush(key, ...values),
}
