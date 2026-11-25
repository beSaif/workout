// Seeded randomness for the fuzz harness. Everything a run decides (state, actions,
// input values) comes from one of these, so --seed N replays the same run.

/** FNV-1a over the parts' string forms: a stable 32-bit seed for (seed, label, ...). */
export function hashSeed(...parts) {
  let h = 0x811c9dc5
  for (const ch of parts.map(String).join("\u0000")) {
    h ^= ch.codePointAt(0)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/**
 * mulberry32: small, fast, good enough for test-input choices, and identical on every
 * platform (pure 32-bit integer maths).
 */
export function createRng(seed) {
  let a = (Number(seed) >>> 0) || 0x9e3779b9
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const rng = {
    seed: Number(seed) >>> 0,
    /** A float in [0, 1). */
    next,
    /** An integer in [min, max], both inclusive. */
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1))
    },
    /** True with probability p. */
    chance(p) {
      return next() < p
    },
    pick(items) {
      if (!items.length) throw new Error("pick from an empty list")
      return items[Math.floor(next() * items.length)]
    },
    /** Pick from [value, weight] pairs. */
    weighted(entries) {
      const total = entries.reduce((s, [, w]) => s + w, 0)
      let r = next() * total
      for (const [value, w] of entries) {
        r -= w
        if (r < 0) return value
      }
      return entries[entries.length - 1][0]
    },
    shuffle(items) {
      const out = [...items]
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        ;[out[i], out[j]] = [out[j], out[i]]
      }
      return out
    },
    /** An independent stream for a sub-task, so adding draws in one place does not shift another. */
    fork(label) {
      return createRng(hashSeed(rng.seed, label))
    },
  }
  return rng
}
