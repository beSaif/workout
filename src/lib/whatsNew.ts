import { WHATS_NEW_SEEN_KEY } from "./types"

export interface WhatsNewItem {
  title: string
  body: string
}

export interface WhatsNewRelease {
  /** Monotonically increasing. Bump when adding a release so existing users see it once. */
  version: number
  items: WhatsNewItem[]
}

/**
 * Newest first. Add a new entry at the top with version = previous + 1.
 * Anyone whose last-seen version is lower sees every newer release in one modal.
 */
export const WHATS_NEW: WhatsNewRelease[] = [
  {
    version: 10,
    items: [
      {
        title: "Jump ahead in your block",
        body: "Today's load feels too light? Every later session on Home now has a Jump button. Tap one (or tap Intensity, Peak or Deload on the timeline and pick a session there) to make it your next session. The ones in between are marked skipped, not trained, and the block carries on from where you landed. Changed your mind? Undo sits right above the card.",
      },
    ],
  },
  {
    version: 9,
    items: [
      {
        title: "Plan your routine with Dot",
        body: "Open Routine and tap Plan with Dot. Answer five quick questions (days a week, session length, equipment, goal, experience) and Dot drafts your training days, muscle groups and exercises. Or copy a prompt into ChatGPT, Claude or Gemini, plan it there and paste the reply back. You see exactly what changes before anything is saved, your history stays with every exercise you keep, and you can undo the switch for a week.",
      },
    ],
  },
  {
    version: 8,
    items: [
      {
        title: "Weigh-ins, once a week",
        body: "The app now asks for your bodyweight once a week instead of every day, and the reminder follows suit. Want to log more often? Tap the + on the bodyweight card any day. The card itself is now a single slim row; tap it for the full chart.",
      },
    ],
  },
  {
    version: 7,
    items: [
      {
        title: "Rest stays out of your way",
        body: "The rest timer no longer takes over the screen. It runs in the navy bar at the top of the logger, which moves straight on to your next set so you can check the weight while you rest. Tap Skip rest in the bar to end it early.",
      },
    ],
  },
  {
    version: 6,
    items: [
      {
        title: "Finishing an exercise lands harder",
        body: "The Done on the last set of an exercise now pops and flashes before the rest timer, and on Android it buzzes about three times as long as an ordinary set. Dot also stays planted on its card while you scroll instead of shaking.",
      },
    ],
  },
  {
    version: 5,
    items: [
      {
        title: "Meet Dot",
        body: "A small navy blob now lives on your home screen and in the logger. It sits on top of your cards, gives a little hop where it stands when you finish a set and looks worried after a grinder. It naps on the rest timer, then goes back to where it was. Tap it for today's prescription and a cue. Your phone gives a small buzz for each set, a double for a grinder and a triple for a new best e1RM. Dot and the haptics each have a switch in the menu.",
      },
    ],
  },
  {
    version: 4,
    items: [
      {
        title: "Cardio, logged in minutes",
        body: "Treadmill, bike, rower, elliptical, stairs, jump rope and incline walk are now in the exercises sheet under Cardio. Open Exercises mid-session, hit Add, and pick one — it logs minutes instead of kg and reps. Tap + distance, + speed or + incline on the card to record more, and the app works out whichever of distance and speed you did not log. Your choice sticks: the next bout of that exercise opens the same way, at last time's numbers. Cardio sits outside your split, so it never joins a training day, never changes what the coach prescribes and never touches your tonnage or PRs.",
      },
    ],
  },
  {
    version: 3,
    items: [
      {
        title: "Skip your main lift for a day",
        body: "Training legs and shoulders and don't want to bench? Hit Skip Bench on the up-next card. The session logs as accessories only and your prescribed load isn't spent — it opens your next session instead, so the block never loses a step.",
      },
    ],
  },
  {
    version: 2,
    items: [
      {
        title: "Bench Press is in the Chest group",
        body: "Chest now starts with Bench Press, so any day that trains chest suggests it like any other exercise. It is added once if your Chest group was missing it — reorder, rename or remove it from Exercise Selection and that sticks.",
      },
    ],
  },
  {
    version: 1,
    items: [
      {
        title: "Choose your training focus",
        body: "New in Exercise Selection: Lift-focused keeps one main lift opening every session with block phases. Balanced drops the forced lift and just follows your training days.",
      },
      {
        title: "Balanced mode home",
        body: "In Balanced mode the home screen shows your recent sessions instead of blocks and targets. You can switch back at any time and your block picks up where it left off.",
      },
    ],
  },
]

export const WHATS_NEW_VERSION = WHATS_NEW[0]?.version ?? 0

export function loadWhatsNewSeen(): number {
  try {
    const raw = localStorage.getItem(WHATS_NEW_SEEN_KEY)
    const n = raw ? parseInt(raw, 10) : 0
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

export function markWhatsNewSeen(version: number = WHATS_NEW_VERSION): void {
  try {
    localStorage.setItem(WHATS_NEW_SEEN_KEY, String(version))
  } catch {
    // Private mode / quota — the modal just shows again next load.
  }
}

/** Releases the user has not yet seen, newest first. */
export function pendingWhatsNew(seen: number = loadWhatsNewSeen()): WhatsNewRelease[] {
  return WHATS_NEW.filter((r) => r.version > seen)
}
