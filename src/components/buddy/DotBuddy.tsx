"use client"

import { useEffect, useRef, useState } from "react"
import {
  DOT_CHANGE_EVENT,
  DOT_MOMENT_EVENT,
  loadDotEnabled,
  type DotCue,
  type DotMoment,
} from "@/lib/buddy"
import { haptic } from "@/lib/haptics"
import HapticTap from "@/components/HapticTap"

/**
 * Dot: a small blob that lives in a layer above the whole screen and stands on
 * whatever is there.
 *
 * It has no fixed slots. Any element marked `data-ledge` is somewhere it can stand —
 * on its top edge, and only where the 30×26 footprint above that edge is clear of
 * text and of anything tappable. It stands on the element, so it scrolls with it; when
 * the element leaves the screen or a sheet covers it, Dot hops to one you can see, and
 * fades out when there is none. Taps pass through everything but Dot itself.
 *
 * A logged set never sends Dot anywhere: it reacts where it stands. It only moves when
 * its ledge goes away (a sheet covers it) or when it wanders.
 *
 * When its ledge scrolls with the page (the home screen), the layer is part of the page
 * rather than pinned to the screen, so the browser scrolls Dot along with the card in
 * the same frame. Following the card from scroll events instead lags it by a frame or
 * more on an iPhone, where the page scrolls off the main thread, and Dot shakes. On a
 * ledge pinned to the screen (the logger) the layer is pinned too.
 *
 * It is cheap while still: the frame loop only runs during a hop or while a pinned
 * ledge's page scrolls, a slow tick handles the rest, and nothing starts until the page
 * has settled after loading.
 *
 * Ledge attributes, all optional beyond `data-ledge`:
 * - `data-ledge-home`: preferred when Dot has to move (the up-next card, the logger).
 * - `data-ledge-watch`: it looks down at what is below while standing there.
 * - `data-ledge-rest`: it naps there, then goes back to where it stood before.
 * - `data-ledge-tone="dark"`: the surface behind it is dark, so it turns white.
 * - `data-ledge-inset="8"`: its feet go this many px below the element's top edge.
 */

type Mood = "idle" | "happy" | "concerned" | "sleepy" | "curious" | "wink"
type Anim = "none" | "travel" | "hop" | "wiggle" | "sink"
type Tone = "light" | "dark"

const W = 30
const H = 26
/** Breathing room from the screen's edges and the notch. */
const EDGE = 6
const WANDER_MIN_MS = 4000
const WANDER_MAX_MS = 9000
/** No wandering while the user is mid-interaction with the screen. */
const QUIET_AFTER_TOUCH_MS = 3000
const NAP_AFTER_MS = 20000
const REST_NAP_DELAY_MS = 1500
/** How long a ledge may be gone (scrolled off, covered) before Dot moves. */
const LOST_GRACE_MS = 350
const CHECK_MS = 250
const SPOT_CHECK_MS = 1000
/** Keep the frame loop going this long after the last scroll, for momentum scrolling. */
const SCROLL_TAIL_MS = 300
/** Wait for the page to settle after loading before Dot looks for a ledge. */
const START_AFTER_MS = 1200
const BUBBLE_MS = 3000

/** What is under Dot's footprint that it must never stand in front of. */
const INTERACTIVE =
  'button, a, input, select, textarea, label, summary, [role="button"], [role="switch"], [contenteditable="true"]'
const MEDIA = "svg, img, canvas, video"

interface Perch {
  el: HTMLElement
  /** Dot's left edge, from the element's left edge. */
  dx: number
  /** The element scrolls with the page, so Dot's layer rides in the page too. */
  inPage: boolean
}

interface Hop {
  fromX: number
  fromY: number
  start: number
  dur: number
  arc: number
}

interface Props {
  /** The tap bubble's line from the coach. Null while logging, where a tap only winks. */
  cue?: DotCue | null
  /** You have been away a while: Dot starts asleep and only a tap on it wakes it. */
  startAsleep?: boolean
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function feetOf(el: HTMLElement, rect: DOMRect): number {
  return rect.top + (Number(el.dataset.ledgeInset) || 0)
}

/** The topmost element at a point that is not part of Dot's own layer. */
function topAt(x: number, y: number): Element | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (!el.closest("[data-dot]")) return el
  }
  return null
}

function pointOnText(el: Element, x: number, y: number): boolean {
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) continue
    const range = document.createRange()
    range.selectNodeContents(node)
    for (const r of Array.from(range.getClientRects())) {
      if (x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2) return true
    }
  }
  return false
}

/**
 * A small painted thing — a progress bar, a phase dot, a badge. Dot may stand in front
 * of a card's background, never in front of one of these.
 */
function isMark(el: Element): boolean {
  const r = el.getBoundingClientRect()
  if (r.height >= 24 && r.width >= 24) return false
  const cs = getComputedStyle(el)
  const alpha = cs.backgroundColor.match(/[\d.]+/g)?.[3]
  const filled = cs.backgroundColor !== "transparent" && (alpha == null || parseFloat(alpha) > 0)
  return filled || cs.backgroundImage !== "none" || parseFloat(cs.borderTopWidth) > 0
}

/** Whether Dot can stand on `el` with its left edge at `left` without covering anything. */
function spotFree(el: HTMLElement, left: number): boolean {
  const rect = el.getBoundingClientRect()
  if (left < EDGE || left + W > window.innerWidth - EDGE) return false
  const feet = feetOf(el, rect)
  for (const dx of [2, 9, 15, 21, 28]) {
    // From the top of its head down to the ledge's edge.
    for (const y of [feet - H + 1, feet - 18, feet - 10, rect.top - 2]) {
      if (y >= rect.top) continue
      const hit = topAt(left + dx, y)
      if (!hit) return false
      if (hit === el || el.contains(hit)) continue
      if (hit.closest(INTERACTIVE) || hit.closest(MEDIA) || isMark(hit)) return false
      if (pointOnText(hit, left + dx, y)) return false
    }
  }
  return true
}

/** On screen, clear of the notch, and not under a sheet, drawer or modal. */
function ledgeUsable(el: HTMLElement, dx: number | null, safeTop: number): boolean {
  if (!el.isConnected) return false
  const r = el.getBoundingClientRect()
  if (r.width < W || r.height === 0) return false
  const feet = feetOf(el, r)
  if (feet - H < safeTop + EDGE || feet > window.innerHeight - EDGE) return false
  const cx = clamp(dx == null ? r.left + r.width / 2 : r.left + dx + W / 2, r.left + 2, r.right - 2)
  if (cx < 0 || cx > window.innerWidth) return false
  const hit = topAt(cx, Math.min(feet + 3, r.bottom - 1))
  return !!hit && (hit === el || el.contains(hit))
}

/** A free left edge on `el`, as close to `preferred` as possible, or anywhere if not given. */
function pickSpot(el: HTMLElement, preferred?: number): number | null {
  const r = el.getBoundingClientRect()
  const lo = Math.max(r.left + 2, EDGE)
  const hi = Math.min(r.right - W - 2, window.innerWidth - W - EDGE)
  if (hi < lo) return null
  if (preferred != null) {
    const start = clamp(preferred, lo, hi)
    for (let step = 0, n = 0; step <= hi - lo && n < 40; step += 8, n++) {
      for (const c of step === 0 ? [start] : [start + step, start - step]) {
        if (c >= lo && c <= hi && spotFree(el, c)) return c
      }
    }
    return null
  }
  for (let i = 0; i < 10; i++) {
    const c = lo + Math.random() * (hi - lo)
    if (spotFree(el, c)) return c
  }
  return null
}

function toneOf(el: HTMLElement): Tone {
  return el.dataset.ledgeTone === "dark" ? "dark" : "light"
}

/**
 * Whether `el` moves only when the page itself scrolls: nothing between it and the page
 * is fixed, sticky or a scroll box of its own. Dot can then ride in the page with it.
 */
function scrollsWithPage(el: HTMLElement): boolean {
  for (let n: HTMLElement | null = el; n && n !== document.body; n = n.parentElement) {
    const cs = getComputedStyle(n)
    if (cs.position === "fixed" || cs.position === "sticky") return false
    if (n !== el && /auto|scroll/.test(cs.overflowY)) return false
  }
  return true
}

/** The page's scroll offset when `inPage`, else none: what turns screen into layer coordinates. */
function layerOffset(inPage: boolean): { x: number; y: number } {
  return inPage ? { x: window.scrollX, y: window.scrollY } : { x: 0, y: 0 }
}

export default function DotBuddy({ cue = null, startAsleep = false }: Props) {
  const [enabled, setEnabled] = useState(false)
  const [shown, setShown] = useState(false)
  const [mood, setMoodState] = useState<Mood>("idle")
  const [look, setLook] = useState(0)
  const [lookDown, setLookDown] = useState(false)
  const [anim, setAnim] = useState<{ name: Anim; n: number; ms?: number }>({ name: "none", n: 0 })
  const [tone, setTone] = useState<Tone>("light")
  const [bubble, setBubble] = useState<{ cue: DotCue; left: number; top: number; above: boolean; tail: number } | null>(null)

  const dotRef = useRef<HTMLButtonElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const cueRef = useRef(cue)
  const startAsleepRef = useRef(startAsleep)
  // Everything the frame loop and the timers read. Kept out of React state so moving
  // Dot never re-renders the page.
  const brain = useRef({
    perch: null as Perch | null,
    /** Where Dot stood before the rest timer covered it, to go back to afterwards. */
    beforeRest: null as Perch | null,
    hop: null as Hop | null,
    /** Where Dot is drawn, in the layer's coordinates (see `inPage`). */
    pos: null as { x: number; y: number } | null,
    /** The layer rides in the page (page coordinates) rather than pinned to the screen. */
    inPage: false,
    mood: "idle" as Mood,
    busyUntil: 0,
    lastTouch: 0,
    lostSince: null as number | null,
    lastSpotCheck: 0,
    lastSearch: 0,
    deepSleep: false,
    restNap: false,
    reduced: false,
    safeTop: 0,
    firstPerch: true,
    timers: new Set<ReturnType<typeof setTimeout>>(),
    moodTimer: null as ReturnType<typeof setTimeout> | null,
    animN: 0,
    /** Run the frame loop for a while: a hop started or the page scrolled. */
    kick: () => {},
  })

  useEffect(() => {
    cueRef.current = cue
  }, [cue])

  // ---- settings ------------------------------------------------------------

  useEffect(() => {
    const sync = () => setEnabled(loadDotEnabled())
    sync()
    window.addEventListener(DOT_CHANGE_EVENT, sync)
    window.addEventListener("storage", sync)
    return () => {
      window.removeEventListener(DOT_CHANGE_EVENT, sync)
      window.removeEventListener("storage", sync)
    }
  }, [])

  // ---- helpers shared by the loop, the timers and the handlers -------------

  const later = (fn: () => void, ms: number) => {
    const b = brain.current
    const t = setTimeout(() => {
      b.timers.delete(t)
      fn()
    }, ms)
    b.timers.add(t)
  }

  const setMood = (m: Mood, revertAfter?: number) => {
    const b = brain.current
    b.mood = m
    setMoodState(m)
    if (b.moodTimer) clearTimeout(b.moodTimer)
    b.moodTimer = null
    if (revertAfter != null) {
      b.moodTimer = setTimeout(() => {
        b.moodTimer = null
        if (b.mood === m) {
          b.mood = "idle"
          setMoodState("idle")
        }
      }, revertAfter)
    }
  }

  const play = (name: Anim, ms?: number) => {
    const b = brain.current
    b.animN += 1
    setAnim({ name, n: b.animN, ms })
  }

  const wake = () => {
    const b = brain.current
    b.deepSleep = false
    b.restNap = false
    if (b.mood === "sleepy") setMood("idle")
  }

  /** Draw Dot at `x`, `y` in the layer's coordinates. */
  const place = (x: number, y: number) => {
    brain.current.pos = { x, y }
    if (dotRef.current) dotRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`
  }

  /** Where Dot is on the screen now, whichever way its layer is attached. */
  const screenPos = (): { x: number; y: number } | null => {
    const b = brain.current
    if (!b.pos) return null
    const o = layerOffset(b.inPage)
    return { x: b.pos.x - o.x, y: b.pos.y - o.y }
  }

  /**
   * Attach the layer to the page or pin it to the screen, keeping Dot where it is on
   * screen. The page version is zero-height so it never makes the page any longer.
   */
  const attachLayer = (inPage: boolean) => {
    const b = brain.current
    if (b.inPage === inPage) return
    const at = screenPos()
    b.inPage = inPage
    const layer = layerRef.current
    if (layer) {
      layer.style.position = inPage ? "absolute" : ""
      layer.style.bottom = inPage ? "auto" : ""
      layer.style.height = inPage ? "0" : ""
      layer.style.overflow = inPage ? "visible" : ""
    }
    if (at) {
      const o = layerOffset(inPage)
      place(at.x + o.x, at.y + o.y)
    }
  }

  /** Put Dot on `el` at `left`, hopping there from wherever it is now. */
  const hopTo = (el: HTMLElement, left: number) => {
    const b = brain.current
    const r = el.getBoundingClientRect()
    const inPage = scrollsWithPage(el)
    attachLayer(inPage)
    // Everything below is in the layer's coordinates.
    const o = layerOffset(inPage)
    const toX = left + o.x
    const toY = feetOf(el, r) - H + o.y
    const from = b.pos ?? { x: toX, y: toY - 40 }
    if (el.hasAttribute("data-ledge-rest") && b.perch && !b.perch.el.hasAttribute("data-ledge-rest")) {
      b.beforeRest = b.perch
    }
    b.perch = { el, dx: left - r.left, inPage }
    b.kick()
    b.restNap = false
    setTone(toneOf(el))
    setLookDown(false)
    const dist = Math.hypot(toX - from.x, toY - from.y)
    if (b.reduced || dist < 2) {
      b.hop = null
      place(toX, toY)
      land()
      return
    }
    const dur = clamp(380 + dist * 0.6, 380, 750)
    setLook(Math.sign(Math.round(toX - from.x)))
    b.hop = {
      fromX: from.x,
      fromY: from.y,
      // eslint-disable-next-line react-hooks/purity -- runs in an imperative hop helper (effects/handlers), not during render
      start: performance.now(),
      dur,
      arc: 22 + Math.min(50, Math.abs(toY - from.y) * 0.12),
    }
    play("travel", dur)
  }

  const land = () => {
    const b = brain.current
    const p = b.perch
    if (!p) return
    setLook(0)
    setLookDown(p.el.hasAttribute("data-ledge-watch"))
    if (p.el.hasAttribute("data-ledge-rest")) {
      later(() => {
        if (b.perch?.el === p.el && Date.now() >= b.busyUntil) {
          b.restNap = true
          setMood("sleepy")
        }
      }, REST_NAP_DELAY_MS)
    }
  }

  const usableLedges = (): HTMLElement[] => {
    const b = brain.current
    return Array.from(document.querySelectorAll<HTMLElement>("[data-ledge]")).filter((el) =>
      ledgeUsable(el, null, b.safeTop)
    )
  }

  /** The best place to go when the current one is gone: home first, then the nearest. */
  const relocate = (): boolean => {
    const b = brain.current
    const current = b.perch?.el
    // Rest is over: back to where Dot stood before it, if that spot is still there.
    const back = b.beforeRest
    if (back && !current?.hasAttribute("data-ledge-rest")) b.beforeRest = null
    else if (back && back.el !== current && ledgeUsable(back.el, back.dx, b.safeTop)) {
      b.beforeRest = null
      const left = back.el.getBoundingClientRect().left + back.dx
      if (spotFree(back.el, left)) {
        hopTo(back.el, left)
        if (b.mood === "sleepy" && !b.deepSleep) wake()
        return true
      }
    }
    const ledges = usableLedges().filter((el) => el !== current)
    const at = screenPos()
    const y = at?.y ?? window.innerHeight / 2
    const byDistance = (a: HTMLElement, c: HTMLElement) =>
      Math.abs(a.getBoundingClientRect().top - y) - Math.abs(c.getBoundingClientRect().top - y)
    // Home first; anywhere else if home has no free spot.
    const pool = [
      ...ledges.filter((el) => el.hasAttribute("data-ledge-home")).sort(byDistance),
      ...ledges.filter((el) => !el.hasAttribute("data-ledge-home")).sort(byDistance),
    ]
    for (const el of pool) {
      const r = el.getBoundingClientRect()
      const preferred = el.hasAttribute("data-ledge-home") ? r.right - W - 36 : at?.x
      const left = pickSpot(el, preferred)
      if (left == null) continue
      const appearing = !b.perch
      hopTo(el, left)
      setShown(true)
      if (b.firstPerch) {
        b.firstPerch = false
        if (startAsleepRef.current) {
          b.deepSleep = true
          setMood("sleepy")
        }
      } else if (!appearing && b.mood === "sleepy" && !b.deepSleep) {
        wake()
      }
      return true
    }
    b.perch = null
    b.hop = null
    b.pos = null
    setShown(false)
    return false
  }

  // ---- following the perch: frames while moving, a slow tick while still ---

  useEffect(() => {
    if (!enabled) return
    const b = brain.current
    b.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches

    const probe = document.createElement("div")
    probe.style.cssText = "position:fixed;top:0;padding-top:env(safe-area-inset-top);visibility:hidden"
    document.body.appendChild(probe)
    b.safeTop = parseFloat(getComputedStyle(probe).paddingTop) || 0
    probe.remove()

    /** Put Dot where its perch is now, or along its hop. */
    const follow = (t: number) => {
      const perch = b.perch
      if (!perch || !perch.el.isConnected) return
      // In page coordinates this target holds still while the page scrolls.
      const r = perch.el.getBoundingClientRect()
      const o = layerOffset(perch.inPage)
      const target = { x: r.left + perch.dx + o.x, y: feetOf(perch.el, r) - H + o.y }
      let { x, y } = target
      const hop = b.hop
      if (hop) {
        const k = Math.min(1, (t - hop.start) / hop.dur)
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2
        x = hop.fromX + (target.x - hop.fromX) * e
        y = hop.fromY + (target.y - hop.fromY) * e - hop.arc * 4 * k * (1 - k)
        if (k >= 1) {
          b.hop = null
          land()
        }
      }
      const prev = b.pos
      if (!prev || Math.abs(prev.x - x) > 0.1 || Math.abs(prev.y - y) > 0.1) place(x, y)
    }

    // Frames only while something moves: a hop, or the page under a pinned Dot scrolling.
    // Riding in the page, Dot needs nothing on scroll: the browser moves it with the card.
    let raf = 0
    let activeUntil = 0
    const frame = (t: number) => {
      raf = 0
      follow(t)
      if (b.hop || performance.now() < activeUntil) raf = requestAnimationFrame(frame)
    }
    b.kick = () => {
      activeUntil = performance.now() + SCROLL_TAIL_MS
      if (!raf) raf = requestAnimationFrame(frame)
    }
    const onScroll = () => {
      if (!b.inPage) b.kick()
    }
    const onResize = () => b.kick()
    window.addEventListener("scroll", onScroll, { capture: true, passive: true })
    window.addEventListener("resize", onResize, { passive: true })

    // The slow tick: find a ledge, notice a lost one, step aside, and catch layout shifts.
    const check = () => {
      const t = performance.now()
      const perch = b.perch
      if (!perch) {
        if (t - b.lastSearch > 500) {
          b.lastSearch = t
          relocate()
        }
        return
      }
      if (!perch.el.isConnected) {
        if (!relocate()) b.pos = null
        return
      }
      if (b.hop) return
      const before = b.pos
      follow(t)
      // The ledge moved without a scroll (a card above it grew): glide along with it.
      if (b.pos !== before) b.kick()
      if (!ledgeUsable(perch.el, perch.dx, b.safeTop)) {
        b.lostSince ??= t
        if (t - b.lostSince > LOST_GRACE_MS) {
          b.lostSince = null
          relocate()
        }
        return
      }
      b.lostSince = null
      // The page can change under Dot (a card expands, a label appears). Step aside.
      if (t - b.lastSpotCheck > SPOT_CHECK_MS) {
        b.lastSpotCheck = t
        const left = perch.el.getBoundingClientRect().left + perch.dx
        if (!spotFree(perch.el, left)) {
          const next = pickSpot(perch.el, left)
          if (next != null) hopTo(perch.el, next)
          else relocate()
        }
      }
    }
    let tick: ReturnType<typeof setInterval> | undefined
    const start = setTimeout(() => {
      check()
      tick = setInterval(check, CHECK_MS)
    }, START_AFTER_MS)

    const timers = b.timers
    return () => {
      clearTimeout(start)
      clearInterval(tick)
      cancelAnimationFrame(raf)
      window.removeEventListener("scroll", onScroll, true)
      window.removeEventListener("resize", onResize)
      b.kick = () => {}
      timers.forEach((t) => clearTimeout(t))
      timers.clear()
      if (b.moodTimer) clearTimeout(b.moodTimer)
      b.perch = null
      b.hop = null
      b.pos = null
      // The layer unmounts with Dot switched off and comes back pinned.
      b.inPage = false
      b.firstPerch = true
    }
    // The loop reads everything through refs; it only restarts when Dot is switched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  // ---- wandering and napping -----------------------------------------------

  useEffect(() => {
    if (!enabled) return
    const b = brain.current
    let id: ReturnType<typeof setTimeout>

    const wander = () => {
      const now = Date.now()
      if (b.reduced || !b.perch || b.hop || now < b.busyUntil) return
      if (b.mood === "sleepy") return
      if (now - b.lastTouch > NAP_AFTER_MS) {
        setMood("sleepy")
        return
      }
      if (now - b.lastTouch < QUIET_AFTER_TOUCH_MS) return
      if (Math.random() < 0.4) {
        setLookDown(false)
        setLook([-1, 0, 1][Math.floor(Math.random() * 3)])
        return
      }
      const cur = b.perch
      const curTop = cur.el.getBoundingClientRect().top
      const options = usableLedges().map((el) => ({
        el,
        w: el === cur.el ? 2.2 : 1 / (1 + Math.abs(el.getBoundingClientRect().top - curTop) / 160),
      }))
      let roll = Math.random() * options.reduce((s, o) => s + o.w, 0)
      const pick = options.find((o) => (roll -= o.w) <= 0) ?? options[options.length - 1]
      if (!pick) return
      const left = pickSpot(pick.el)
      if (left != null) hopTo(pick.el, left)
    }

    const schedule = () => {
      id = setTimeout(() => {
        wander()
        schedule()
      }, WANDER_MIN_MS + Math.random() * (WANDER_MAX_MS - WANDER_MIN_MS))
    }
    b.lastTouch = Date.now()
    schedule()

    const onTouch = (e: Event) => {
      b.lastTouch = Date.now()
      const fromDot = e.target instanceof Element && e.target.closest("[data-dot]")
      if (!fromDot) setBubble(null)
      if (!fromDot && b.mood === "sleepy" && !b.deepSleep && !b.restNap) {
        setMood("curious", 700)
      }
    }
    const onScroll = () => {
      b.lastTouch = Date.now()
      setBubble(null)
    }
    window.addEventListener("pointerdown", onTouch, true)
    window.addEventListener("keydown", onTouch, true)
    window.addEventListener("scroll", onScroll, { capture: true, passive: true })
    return () => {
      clearTimeout(id)
      window.removeEventListener("pointerdown", onTouch, true)
      window.removeEventListener("keydown", onTouch, true)
      window.removeEventListener("scroll", onScroll, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  // ---- moments from the logger ----------------------------------------------

  useEffect(() => {
    if (!enabled) return
    const b = brain.current

    const onMoment = (e: Event) => {
      const moment = (e as CustomEvent<DotMoment>).detail
      b.lastTouch = Date.now()
      // The Done tap re-renders the logger (often into the rest timer) after this
      // event, so look for where to go once the screen has caught up.
      later(() => react(moment), 60)
    }

    // Dot reacts where it stands; a set never sends it to the progress row. It only
    // moves if its ledge just went away, as when the rest timer covers the screen, and
    // then by the same rule as for any lost ledge (the rest timer is a home ledge).
    const react = (m: DotMoment) => {
      b.deepSleep = false
      b.restNap = false
      if (!b.perch || !ledgeUsable(b.perch.el, b.perch.dx, b.safeTop)) relocate()
      if (!b.perch) return
      b.busyUntil = Date.now() + 1200
      if (m.kind === "heavy") setMood("concerned", 1500)
      else setMood("happy", 900)
      if (!b.hop) play(m.kind === "heavy" ? "sink" : "hop")
    }

    window.addEventListener(DOT_MOMENT_EVENT, onMoment)
    return () => window.removeEventListener(DOT_MOMENT_EVENT, onMoment)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  if (!enabled) return null

  function handleTap() {
    const b = brain.current
    b.lastTouch = Date.now()
    haptic("tap")
    if (b.mood === "sleepy") {
      b.deepSleep = false
      b.restNap = false
      setMood("curious", 800)
      play("hop")
    } else {
      setMood("wink", 700)
      play("wiggle")
    }
    const c = cueRef.current
    if (bubble || !c || !b.pos) {
      setBubble(null)
      return
    }
    // The bubble shares Dot's layer, so it is placed in the layer's coordinates too.
    const width = 240
    const left = clamp(b.pos.x + W / 2 - width / 2, 12, window.innerWidth - width - 12)
    const above = (screenPos()?.y ?? 0) > 150
    setBubble({
      cue: c,
      left,
      top: above ? b.pos.y - 10 : b.pos.y + H + 10,
      above,
      tail: clamp(b.pos.x + W / 2 - left, 16, width - 16),
    })
    later(() => setBubble(null), BUBBLE_MS)
  }

  const eyes = eyeShapes(mood, look, lookDown)
  const animClass = anim.name === "none" ? "" : `dot-${anim.name}-${anim.n % 2}`

  return (
    <div ref={layerRef} data-dot aria-hidden="true" className="fixed inset-0 z-[55] pointer-events-none overflow-hidden">
      {bubble && (
        <div
          className="absolute w-[240px] rounded-[14px] bg-raised border border-line px-3 py-2.5 shadow-[0_10px_24px_rgba(17,24,39,0.12)] flex flex-col gap-0.5 animate-fade-in"
          style={{ left: bubble.left, top: bubble.top, transform: bubble.above ? "translateY(-100%)" : undefined }}
        >
          <span className="text-[10px] font-bold tracking-[0.12em] text-brand">TODAY</span>
          <span className="text-[13px] font-semibold text-ink tabular-nums">{bubble.cue.title}</span>
          <span className="text-xs leading-snug text-ink-4">{bubble.cue.line}</span>
          <span
            className={`absolute w-3 h-3 bg-surface border-line rotate-45 ${
              bubble.above ? "-bottom-[7px] border-r border-b" : "-top-[7px] border-l border-t"
            }`}
            style={{ left: bubble.tail - 6 }}
          />
        </div>
      )}

      <button
        ref={dotRef}
        type="button"
        tabIndex={-1}
        onClick={handleTap}
        className={`absolute left-0 top-0 w-[30px] h-[26px] p-0 m-0 border-0 bg-transparent touch-manipulation transition-opacity duration-300 [-webkit-tap-highlight-color:transparent] ${
          shown ? "opacity-100 pointer-events-auto" : "opacity-0"
        }`}
      >
        <div
          className={`dot-anim ${animClass}`}
          style={anim.ms ? { animationDuration: `${anim.ms}ms` } : undefined}
        >
          <div className={`dot-shadow ${tone === "dark" ? "dot-shadow-dark" : ""}`} />
          <div className={`dot-body ${tone === "dark" ? "dot-body-dark" : ""}`}>
            {mood === "concerned" && (
              <>
                <span className="dot-brow" style={{ left: 6, top: 6, transform: "rotate(-20deg)" }} />
                <span className="dot-brow" style={{ left: 17, top: 6, transform: "rotate(20deg)" }} />
              </>
            )}
            {eyes.map((e, i) => (
              <span key={i} className={e.cls} style={{ left: e.left, top: e.top, width: e.w, height: e.h }} />
            ))}
          </div>
          {mood === "concerned" && <span className="dot-sweat" style={{ left: 31, top: 1 }} />}
          {mood === "sleepy" && (
            <>
              <span className="dot-z" style={{ left: 32, top: -6 }}>z</span>
              <span className="dot-z" style={{ left: 38, top: -14, fontSize: 7, animationDelay: "400ms" }}>z</span>
            </>
          )}
        </div>
        <HapticTap />
      </button>
    </div>
  )
}

interface Eye {
  cls: string
  left: number
  top: number
  w: number
  h: number
}

function eyeShapes(mood: Mood, look: number, lookDown: boolean): [Eye, Eye] {
  const lk = look * 1.5
  const oval = (left: number, top: number, w = 4, h = 7): Eye => ({ cls: "dot-eye", left, top, w, h })
  const arc = (left: number, top: number): Eye => ({ cls: "dot-arc", left, top, w: 8, h: 5 })
  const line = (left: number): Eye => ({ cls: "dot-line", left, top: 13, w: 7, h: 2 })
  switch (mood) {
    case "happy":
      return [arc(6, 9), arc(16, 9)]
    case "concerned":
      return [oval(8, 10, 4, 5), oval(18, 10, 4, 5)]
    case "sleepy":
      return [line(6), line(17)]
    case "curious":
      return [oval(10 + lk, 8), oval(19 + lk, 7, 5, 9)]
    case "wink":
      return [arc(6, 9), oval(18, 8)]
    default: {
      const top = lookDown ? 10 : 8
      return [oval(8 + lk, top), oval(18 + lk, top)]
    }
  }
}
