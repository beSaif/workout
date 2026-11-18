import { HAPTICS_KEY } from "./types"
import { localSource, notifyLocalChange } from "./useLocalValue"

/**
 * The five buzzes the app makes for Dot's moments, on both phones.
 *
 * Android (Chrome or the installed app) has the Vibration API and plays the patterns
 * as written: on, off, on, in milliseconds. Safari has no Vibration API, but from
 * iOS 18 toggling an `<input type="checkbox" switch>` plays the system's light tap.
 * That tap has one strength, so on an iPhone a pattern becomes a count of ticks.
 * Anywhere else both routes do nothing, which is the intended fallback: a haptic is
 * never the only signal of anything.
 *
 * On iOS 26.5 and later a switch toggled from script no longer ticks (WebKit bug
 * 309082): only a real finger landing on the switch's label does. So a button that
 * should be felt on an iPhone wears a <HapticTap /> — an invisible label over the
 * button that the tap lands on — and that tap is the first tick. The extra ticks of
 * a heavy set or a best still go through script, which older iOS versions play.
 *
 * Call it from the tap that caused the moment, not from an effect: iOS only plays the
 * switch's tap inside a user gesture.
 */
export type HapticKind = "set" | "exercise" | "heavy" | "pr" | "tap"

// Shorter than about 20 ms and many Android motors never spin up enough to be felt.
// An Android motor has one strength, so a harder buzz is a longer one: the set that
// finishes an exercise lands about three times as long as an ordinary set.
const PATTERNS: Record<HapticKind, number[]> = {
  set: [22],
  exercise: [65],
  heavy: [30, 90, 30],
  pr: [22, 70, 22, 70, 45],
  tap: [15],
}

/** Gap between the iPhone's ticks when a pattern has more than one pulse. */
const IOS_TICK_GAP_MS: Record<HapticKind, number> = { set: 0, exercise: 0, heavy: 120, pr: 90, tap: 0 }

/** Two moments this close together would blur into one buzz, so the second is dropped. */
const MIN_GAP_MS = 600

let lastAt = 0
/** When a real tap last landed on a <HapticTap /> label, which played the first tick. */
let tappedAt = -Infinity

export const HAPTICS_CHANGE_EVENT = "haptics-change"

export function loadHapticsEnabled(): boolean {
  try {
    return localStorage.getItem(HAPTICS_KEY) !== "off"
  } catch {
    return true
  }
}

export function saveHapticsEnabled(on: boolean): void {
  try {
    if (on) localStorage.removeItem(HAPTICS_KEY)
    else localStorage.setItem(HAPTICS_KEY, "off")
  } catch {
    // Private mode: the switch just will not stick past this page.
  }
  notifyLocalChange()
  window.dispatchEvent(new Event(HAPTICS_CHANGE_EVENT))
}

/** The switch, for useLocalValue. */
export const hapticsEnabledSource = localSource([HAPTICS_KEY], loadHapticsEnabled)

export function haptic(kind: HapticKind): void {
  if (typeof window === "undefined" || !loadHapticsEnabled()) return
  const now = Date.now()
  if (now - lastAt < MIN_GAP_MS) return
  lastAt = now

  const pattern = PATTERNS[kind]
  if (typeof navigator.vibrate === "function") {
    navigator.vibrate(pattern)
    return
  }
  const ticks = Math.ceil(pattern.length / 2)
  // The tap that brought us here already ticked if it landed on a HapticTap label.
  if (performance.now() - tappedAt > 300) iosTick()
  for (let i = 1; i < ticks; i++) setTimeout(iosTick, i * IOS_TICK_GAP_MS[kind])
}

/**
 * Whether this is an iPhone that ticks a switch: Safari on a touch screen that knows
 * the `switch` attribute and has no Vibration API. An iPad has nothing to tick, and
 * iOS 17 knows `switch` but never ticks it (17 is long out of support, so it is not
 * worth telling apart from the user agent, which a home-screen app freezes anyway).
 */
export function canTickSwitch(): boolean {
  if (typeof window === "undefined") return false
  tickSwitch ??= detectTickSwitch()
  return tickSwitch
}

let tickSwitch: boolean | undefined

function detectTickSwitch(): boolean {
  if (typeof navigator.vibrate === "function" || navigator.maxTouchPoints === 0) return false
  if (/iPad|Macintosh/.test(navigator.userAgent)) return false
  try {
    return "switch" in document.createElement("input")
  } catch {
    return false
  }
}

/**
 * Run a button's work after its HapticTap has ticked. The tick is the label's default
 * action, which the browser runs only once the click has finished dispatching; if the
 * handler re-renders the button away first (Done turns the logger into the rest
 * timer), the label is gone and nothing ticks. So on an iPhone the work waits a task.
 */
export function afterHapticTap(fn: () => void): void {
  if (canTickSwitch()) setTimeout(fn, 0)
  else fn()
}

/**
 * A real tap just landed on a HapticTap label. Returns whether the switch may toggle,
 * which is what plays the tick: not while haptics are switched off, unless `force`
 * says otherwise.
 */
export function noteHapticTap(force?: boolean): boolean {
  if (!(force ?? loadHapticsEnabled())) return false
  tappedAt = performance.now()
  return true
}

/** One system tap on iOS 18+: a throwaway switch, toggled through its label. */
function iosTick(): void {
  try {
    const label = document.createElement("label")
    label.setAttribute("aria-hidden", "true")
    label.style.display = "none"
    const input = document.createElement("input")
    input.type = "checkbox"
    input.setAttribute("switch", "")
    label.appendChild(input)
    document.head.appendChild(label)
    label.click()
    label.remove()
  } catch {
    // Nothing to fall back to; the moment still shows on screen.
  }
}
