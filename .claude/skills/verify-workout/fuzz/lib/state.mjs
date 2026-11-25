// Seeded account state for a monkey: profile, history, weigh-ins and routine, shaped
// like src/lib/types.ts and accepted by the server's own validators (src/lib/validate.ts,
// checked in fuzz.test.ts), so a finding is about a state a real account can be in.

const DAY = 24 * 60 * 60 * 1000

/**
 * The only identity a signed-in fuzz run uses: a dedicated test user on a reserved
 * (.invalid) domain, never a real account. Its data lives only in the in-browser fake.
 */
export const FUZZ_USER = Object.freeze({ sub: "fuzz-bot", email: "fuzz-bot@workout.invalid", name: "Fuzz Bot" })

/** Loads in kg, including the edges: tiny, odd decimals, and very heavy. */
export const ANCHOR_VALUES = [1, 20, 42.5, 60, 80, 102.5, 142.5, 250, 500]
export const BODYWEIGHT_VALUES = [30, 55.5, 80, 95.3, 140, 250]
export const MAIN_LIFTS = ["bench", "squat", "deadlift"]

const PHASES = [
  // [block phase, session type, sessions in a standard block]
  ["accumulation", "Volume", 9],
  ["transmutation", "Intensity", 6],
  ["realization", "Peak", 3],
  ["deload", "Deload", 1],
]

const GROUPS = [
  ["chest", "Chest", ["Incline Dumbbell Press", "Cable Fly", "Dips"]],
  ["back", "Back", ["Pull-up", "Barbell Row", "Lat Pulldown"]],
  ["legs", "Legs", ["Back Squat", "Romanian Deadlift", "Leg Press"]],
  ["shoulders", "Shoulders", ["Overhead Press", "Lateral Raise"]],
  ["arms", "Arms", ["Barbell Curl", "Triceps Pushdown"]],
  ["core", "Core", ["Plank", "Hanging Leg Raise"]],
]

const round = (n, step = 0.5) => Math.round(n / step) * step
const brzycki = (kg, reps) => (reps >= 37 ? null : Math.round(kg * (36 / (37 - reps)) * 10) / 10)

function localDate(d) {
  const p = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function sets(rng, kg, n) {
  return Array.from({ length: n }, (_, i) => {
    const reps = rng.int(1, 12)
    const w = Math.max(0, round(kg * (0.85 + rng.next() * 0.3), 2.5))
    return { id: `S${i + 1}`, kg: w, reps, rpe: rng.chance(0.5) ? null : rng.int(6, 10), e1rm: brzycki(w, reps), note: rng.chance(0.1) ? "fuzz note" : "", isWarmup: false }
  })
}

function extras(rng, groupIds) {
  const muscles = rng.shuffle(groupIds).slice(0, rng.int(0, Math.min(3, groupIds.length)))
  return muscles.map((m) => {
    const group = GROUPS.find((g) => g[0] === m)
    return {
      muscle: m,
      exercises: rng.shuffle(group ? group[2] : ["Push-up"]).slice(0, rng.int(1, 2)).map((name) => ({
        name,
        sets: Array.from({ length: rng.int(1, 4) }, () => ({ kg: round(rng.int(0, 120), 2.5), reps: rng.int(1, 20), rpe: null })),
      })),
    }
  })
}

/**
 * A lift-focused history: cycles of Volume → Intensity → Peak → Deload blocks filled in
 * order, the last block left active, plus the odd skipped-main-lift "Free" session.
 */
function liftHistory(rng, count, anchor, bw, now) {
  const sessions = []
  const blocks = []
  let phase = 0
  let block = null
  let day = count * 2 + rng.int(0, 10)
  for (let id = 1; id <= count; id++) {
    day = Math.max(0, day - rng.int(1, 3))
    const date = new Date(now - day * DAY).toISOString()
    if (rng.chance(0.08)) {
      sessions.push({ id, date, type: "Free", bw, sets: [], confirmed: true, coachNote: "", skippedMainLift: true, extraWorkouts: extras(rng, GROUPS.map((g) => g[0])) })
      continue
    }
    const [blockPhase, type, length] = PHASES[phase % PHASES.length]
    if (!block) {
      block = { id: blocks.length + 1, phase: blockPhase, status: "active", sessionIds: [], anchorWeight: anchor, length, startDate: date, endDate: null, schemeVersion: 3, cycleLength: "standard" }
      blocks.push(block)
    }
    sessions.push({ id, date, type, bw, sets: sets(rng, anchor * (type === "Peak" ? 0.95 : type === "Deload" ? 0.6 : 0.75), rng.int(1, 5)), confirmed: true, coachNote: rng.chance(0.3) ? "felt good" : "", blockId: block.id })
    block.sessionIds.push(id)
    if (block.sessionIds.length >= length) {
      block.status = "completed"
      block.endDate = date
      block = null
      phase += 1
    }
  }
  return { sessions, blocks }
}

function balancedHistory(rng, count, bw, now, groupIds, dayIds) {
  const sessions = []
  let day = count * 2
  for (let id = 1; id <= count; id++) {
    day = Math.max(0, day - rng.int(1, 3))
    sessions.push({
      id,
      date: new Date(now - day * DAY).toISOString(),
      type: "Free",
      bw,
      sets: [],
      confirmed: true,
      coachNote: "",
      ...(dayIds.length ? { selectedTrainingDayId: rng.pick(dayIds) } : {}),
      extraWorkouts: extras(rng, groupIds),
    })
  }
  return { sessions, blocks: [] }
}

function routine(rng) {
  const groups = rng.shuffle(GROUPS).slice(0, rng.int(1, GROUPS.length))
  const exercises = groups.map(([id, name, names], order) => ({
    id,
    name,
    order,
    exercises: names.slice(0, rng.int(0, names.length)).map((n, i) => ({ id: n.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: n, order: i, defaultSets: rng.int(1, 5) })),
  }))
  const trainingDays = Array.from({ length: rng.int(1, 6) }, (_, i) => ({
    id: `day-${i + 1}`,
    name: rng.pick(["Push", "Pull", "Legs", "Upper", "Lower", "Full Body", "Day 💪"]),
    order: i,
    muscleGroupIds: rng.shuffle(groups.map((g) => g[0])).slice(0, rng.int(0, groups.length)),
  }))
  return { exercises, trainingDays }
}

/**
 * A random account for `user`: { profile, sessions, weights, exercises, trainingDays,
 * summary }. `null` for a resource means "never saved" (the fake answers null, as the
 * real API does for a new account).
 */
export function generateState(rng, user, now = Date.now()) {
  const trainingMode = rng.pick(["lift-focused", "balanced"])
  const bw = rng.pick(BODYWEIGHT_VALUES)
  const anchor = rng.pick(ANCHOR_VALUES)
  const target = rng.chance(0.2) ? anchor : rng.pick(ANCHOR_VALUES)
  const mainLift = rng.pick(MAIN_LIFTS)
  const profile = {
    email: user.email,
    name: user.name,
    bw,
    trainingMode,
    ...(trainingMode === "lift-focused" || rng.chance(0.5) ? { mainLift, anchor, target } : {}),
    trainingAge: rng.pick(["new", "some", "years"]),
    // Absent means "never asked", which opens the one-time opt-in sheet: a real state too.
    ...(rng.chance(0.8) ? { weighInDaily: rng.chance(0.5) } : {}),
    ...(rng.chance(0.3) ? { goalBw: rng.pick(BODYWEIGHT_VALUES) } : {}),
    createdAt: new Date(now - rng.int(0, 400) * DAY).toISOString(),
  }

  const custom = rng.chance(0.5) ? routine(rng) : null
  const groupIds = custom ? custom.exercises.map((g) => g.id) : GROUPS.map((g) => g[0])
  const dayIds = custom ? custom.trainingDays.map((d) => d.id) : []

  const count = rng.int(0, 40)
  const history = count === 0 && rng.chance(0.5)
    ? null
    : trainingMode === "lift-focused"
      ? liftHistory(rng, count, anchor, bw, now)
      : balancedHistory(rng, count, bw, now, groupIds, dayIds)

  const weighIns = rng.int(0, 30)
  const weights = weighIns === 0 && rng.chance(0.5)
    ? null
    : Array.from({ length: weighIns }, (_, i) => {
        const d = new Date(now - (weighIns - i) * rng.int(1, 3) * DAY)
        return { date: localDate(d), kg: round(bw + (rng.next() - 0.5) * 6, 0.1), loggedAt: d.toISOString() }
      }).filter((w, i, all) => all.findIndex((x) => x.date === w.date) === i)

  return {
    profile,
    sessions: history,
    weights,
    exercises: custom ? custom.exercises : null,
    trainingDays: custom ? custom.trainingDays : null,
    summary:
      `${trainingMode}${profile.mainLift ? ` ${profile.mainLift}` : ""}, anchor ${profile.anchor ?? "-"} kg, target ${profile.target ?? "-"} kg, ` +
      `bw ${bw} kg, ${history ? history.sessions.length : 0} sessions, ${weights ? weights.length : 0} weigh-ins, ` +
      `${custom ? `custom routine (${custom.exercises.length} groups, ${custom.trainingDays.length} days)` : "default routine"}`,
  }
}

/** Values the monkey types into inputs: zero, negative, huge, both decimal marks, blanks, long text, emoji. */
export const EDGE_INPUTS = Object.freeze([
  "0",
  "-1",
  "-42.5",
  "999999",
  "12,5",
  "12.5",
  "0.001",
  "",
  "   ",
  "Lorem ipsum dolor sit amet ".repeat(8).slice(0, 200),
  "💪🔥🏋️‍♀️",
  "Fuzz Bot",
])
