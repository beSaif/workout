"use client"

import { useState, useEffect, useLayoutEffect } from "react"
import { useRouter } from "next/navigation"
import { signIn } from "next-auth/react"
import { MainLift, MAIN_LIFT_LABEL, TrainingMode, TRAINING_MODE_LABEL, TRAINING_MODE_DESC } from "@/lib/types"
import { loadProfile, saveProfile } from "@/lib/storage"
import { markWhatsNewSeen } from "@/lib/whatsNew"

// 0 name · 1 bodyweight · 2 hook · 3 two parts · 4 training focus
// 5 lift · 6 phases · 7 anchor · 8 target (lift-focused only) · 9 sign in
type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
const LAST_STEP: Step = 9
const MODE_STEP: Step = 4
const ALL_STEPS: Step[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
const BALANCED_STEPS: Step[] = [0, 1, 2, 3, 4, 9]

const LIFTS: MainLift[] = ["bench", "deadlift", "squat"]
const MODES: TrainingMode[] = ["lift-focused", "balanced"]
const PENDING_KEY = "lift-tracker-pending-onboarding"
const TIMED_STEPS = new Set([2, 3, 6, 9])

interface PendingOnboarding {
  name: string
  bw: string
  mode: TrainingMode
  lift: MainLift | null
  anchor: string
  target: string
  /** Absent on payloads written before daily check-ins shipped — see autoFinish. */
  weighInDaily?: boolean
}

function roundTo2p5(kg: number): number {
  return Math.round(kg / 2.5) * 2.5
}

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>(0)
  const [checking, setChecking] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const [readUnlocked, setReadUnlocked] = useState(false)

  const [name, setName] = useState("")
  const [bw, setBw] = useState("")
  // Opted in by default: it rides along with a weight they are already typing, and the
  // home screen's toggle and /profile both make it one tap to turn off.
  const [weighInDaily, setWeighInDaily] = useState(true)
  const [mode, setMode] = useState<TrainingMode | null>(null)
  const [lift, setLift] = useState<MainLift | null>(null)
  const [anchor, setAnchor] = useState("")
  const [target, setTarget] = useState("")

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const isPostAuth = params.get("auth") === "1"

    if (isPostAuth) {
      const raw = localStorage.getItem(PENDING_KEY)
      if (raw) {
        try {
          const d = JSON.parse(raw) as PendingOnboarding
          localStorage.removeItem(PENDING_KEY)
          // Payloads saved before the mode existed carry no mode field; they were lift-focused.
          autoFinish({ ...d, mode: d.mode ?? "lift-focused" })
          return
        } catch {
          localStorage.removeItem(PENDING_KEY)
        }
      }
    }

    loadProfile().then((p) => {
      if (p) {
        router.replace("/")
        return
      }
      setChecking(false)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  useLayoutEffect(() => {
    if (!TIMED_STEPS.has(step)) return
    setReadUnlocked(false)
  }, [step])

  // The sign-in step keeps a beat of pause, but not the whole word-by-word reveal.
  useEffect(() => {
    if (step !== LAST_STEP) return
    const id = setTimeout(() => setReadUnlocked(true), 1200)
    return () => clearTimeout(id)
  }, [step])

  async function autoFinish(d: PendingOnboarding) {
    setSubmitting(true)
    const liftFocused = d.mode === "lift-focused"
    const result = await saveProfile({
      name: d.name.trim(),
      bw: parseFloat(d.bw),
      trainingMode: d.mode,
      ...(liftFocused && d.lift
        ? { mainLift: d.lift, anchor: parseFloat(d.anchor), target: parseFloat(d.target) }
        : {}),
      // A payload stashed before this shipped has no answer. Leave the field absent
      // rather than defaulting to false, so those users get asked on the home screen
      // instead of being silently opted out of something they never saw.
      ...(typeof d.weighInDaily === "boolean" ? { weighInDaily: d.weighInDaily } : {}),
    })
    setSubmitting(false)
    if (result) {
      // A brand-new user has nothing "new" to catch up on.
      markWhatsNewSeen()
      router.replace("/")
    } else {
      setChecking(false)
    }
  }

  // Balanced users skip the lift, phases, anchor and target steps entirely.
  const visibleSteps = mode === "balanced" ? BALANCED_STEPS : ALL_STEPS

  function next() {
    setStep((s) => {
      const i = visibleSteps.indexOf(s)
      return visibleSteps[Math.min(visibleSteps.length - 1, i + 1)] ?? LAST_STEP
    })
  }

  function back() {
    setStep((s) => {
      const i = visibleSteps.indexOf(s)
      return visibleSteps[Math.max(0, i - 1)] ?? 0
    })
  }

  async function handleGoogleSignIn() {
    const pending: PendingOnboarding = { name, bw, mode: mode ?? "lift-focused", lift, anchor, target, weighInDaily }
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending))
    await signIn("google", { callbackUrl: "/onboarding?auth=1" })
  }

  const canAdvance = (() => {
    if (step === 0) return name.trim().length > 0
    if (step === 1) {
      const v = parseFloat(bw)
      return Number.isFinite(v) && v > 0
    }
    // The explainer steps animate in, but reading along is optional: continue is live
    // from the start, so someone who has seen it before isn't held for ~16s.
    if (step === 2) return true
    if (step === 3) return true
    if (step === 4) return mode !== null
    if (step === 5) return lift !== null
    if (step === 6) return true
    if (step === 7) {
      const v = parseFloat(anchor)
      return Number.isFinite(v) && v > 0
    }
    if (step === 8) {
      const v = parseFloat(target)
      return Number.isFinite(v) && v > 0
    }
    if (step === 9) return true
    return false
  })()

  const anchorVal = parseFloat(anchor)
  const targetSuggestions: { kg: number; label: string }[] =
    Number.isFinite(anchorVal) && anchorVal > 0
      ? [
          { kg: roundTo2p5(anchorVal * 1.1), label: "+10%" },
          { kg: roundTo2p5(anchorVal * 1.2), label: "+20%" },
          { kg: roundTo2p5(anchorVal * 1.3), label: "+30%" },
        ]
      : []

  if (checking || submitting) {
    return (
      <main className="min-h-dvh bg-white flex items-center justify-center">
        {submitting && <p className="text-sm text-[#777777]">saving…</p>}
      </main>
    )
  }

  return (
    <main className="min-h-dvh flex flex-col bg-white">
      {/* Progress dots */}
      <div className="flex justify-center gap-1.5 pt-8 pb-12">
        {visibleSteps.map((i) => (
          <div
            key={i}
            className={`h-1 rounded-full transition-all ${
              i === step ? "w-8 bg-[#1e3a5f]" : i < step ? "w-1.5 bg-[#1e3a5f]/40" : "w-1.5 bg-[#e8e8e8]"
            }`}
          />
        ))}
      </div>

      <div className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-[360px]">

          {/* Step 0: name */}
          {step === 0 && (
            <Question label="what do we call you?" hint="first name is fine.">
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && canAdvance) next() }}
                placeholder="Saif"
                className="w-full text-2xl font-semibold text-[#111111] border-b-2 border-[#e8e8e8] focus:border-[#1e3a5f] outline-none bg-transparent pb-2"
              />
            </Question>
          )}

          {/* Step 1: bodyweight */}
          {step === 1 && (
            <Question label="how much do you weigh?" hint="in kg — we use this to track your relative strength over time.">
              <div className="flex items-baseline gap-2 border-b-2 border-[#e8e8e8] focus-within:border-[#1e3a5f] pb-2">
                <input
                  autoFocus
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  value={bw}
                  onChange={(e) => setBw(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && canAdvance) next() }}
                  placeholder="60"
                  className="flex-1 text-2xl font-semibold text-[#111111] outline-none bg-transparent"
                />
                <span className="text-base text-[#aaaaaa]">kg</span>
              </div>

              {/* The opt-in rides on this step rather than getting one of its own: the
                  weight is already on screen, so there is nothing to ask twice. Step 1
                  is in both ALL_STEPS and BALANCED_STEPS, so both modes get it. */}
              <button
                type="button"
                onClick={() => setWeighInDaily((v) => !v)}
                className="w-full mt-8 flex items-center gap-3 text-left"
              >
                <span
                  className={`w-5 h-5 shrink-0 rounded-md border-2 flex items-center justify-center transition-colors ${
                    weighInDaily ? "bg-[#1e3a5f] border-[#1e3a5f]" : "border-[#d8d8d8]"
                  }`}
                >
                  {weighInDaily && (
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="3,8.5 6.5,12 13,4" />
                    </svg>
                  )}
                </span>
                <span className="flex-1">
                  <span className="block text-sm text-[#111111]">check in weekly</span>
                  <span className="block text-xs text-[#999999] mt-0.5">
                    we&apos;ll ask for this number once a week and chart the trend. log more
                    often anytime.
                  </span>
                </span>
              </button>
            </Question>
          )}

          {/* Step 2: hook — label then hint word-by-word */}
          {step === 2 && (
            <Question
              label="most people track everything. most people quit."
              hint="this app does it differently. one lift. one goal. actually works."
              highlight
              onHighlightComplete={() => setReadUnlocked(true)}
            />
          )}

          {/* Step 3: label then bullets one by one */}
          {step === 3 && (
            <Question
              label="the program has two parts."
              highlight
              onHighlightComplete={() => setReadUnlocked(true)}
            >
              {(bodyVisible, onBodyComplete) => (
                <div className="space-y-5 mt-2">
                  {([
                    { dot: "#1e3a5f", name: "main lift", desc: " — one exercise. tracked weekly. you always have a target." },
                    { dot: "#888888", name: "accessories", desc: " — everything else. chest, back, whatever. you pick these each session." },
                  ] as const).map(({ dot, name: itemName, desc }, i, arr) => (
                    <div
                      key={itemName}
                      style={{ transitionDelay: `${i * 450}ms` }}
                      className={`flex items-start gap-3 transition-opacity duration-500 ${bodyVisible ? "opacity-100" : "opacity-0"}`}
                      onTransitionEnd={i === arr.length - 1 ? (e) => { if (e.propertyName === "opacity") onBodyComplete?.() } : undefined}
                    >
                      <div className="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: dot }} />
                      <div>
                        <span className="text-sm font-semibold text-[#111111]">{itemName}</span>
                        <span className="text-sm text-[#777777]">{desc}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Question>
          )}

          {/* Step 4: training focus */}
          {step === MODE_STEP && (
            <Question label="how do you want to train?" hint="you can change this later in exercise selection.">
              <div className="space-y-2">
                {MODES.map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`w-full text-left px-4 py-4 rounded-xl border-2 transition-colors ${
                      mode === m
                        ? "border-[#1e3a5f] bg-[#eff6ff]"
                        : "border-[#e8e8e8] hover:border-[#cccccc]"
                    }`}
                  >
                    <span className={`block text-base font-semibold ${mode === m ? "text-[#1e3a5f]" : "text-[#111111]"}`}>
                      {TRAINING_MODE_LABEL[m].toLowerCase()}
                    </span>
                    <span className="block text-sm text-[#777777] mt-1 leading-snug">
                      {TRAINING_MODE_DESC[m].toLowerCase()}
                    </span>
                  </button>
                ))}
              </div>
            </Question>
          )}

          {/* Step 5: lift selection */}
          {step === 5 && (
            <Question label="what lift are you training?" hint="pick the one you're building your program around.">
              <div className="space-y-2">
                {LIFTS.map((l) => (
                  <button
                    key={l}
                    onClick={() => setLift(l)}
                    className={`w-full text-left px-4 py-4 rounded-xl border-2 transition-colors ${
                      lift === l
                        ? "border-[#1e3a5f] bg-[#eff6ff] text-[#1e3a5f]"
                        : "border-[#e8e8e8] text-[#111111] hover:border-[#cccccc]"
                    }`}
                  >
                    <span className="text-base font-semibold">{MAIN_LIFT_LABEL[l]}</span>
                  </button>
                ))}
              </div>
            </Question>
          )}

          {/* Step 6: label then phases — labels first, then descriptions */}
          {step === 6 && (
            <Question
              label="your main lift runs in 4-phase cycles."
              highlight
              onHighlightComplete={() => setReadUnlocked(true)}
            >
              {(bodyVisible, onBodyComplete) => (
                <PhasesReveal started={bodyVisible} onComplete={onBodyComplete} />
              )}
            </Question>
          )}

          {/* Step 7: current 1RM */}
          {step === 7 && (
            <Question
              label={`what's your current 1 rep max on ${lift ? MAIN_LIFT_LABEL[lift].toLowerCase() : "your lift"}?`}
              hint="your best single rep. be honest — every session is a percentage of this."
            >
              <div className="flex items-baseline gap-2 border-b-2 border-[#e8e8e8] focus-within:border-[#1e3a5f] pb-2">
                <input
                  autoFocus
                  type="number"
                  inputMode="decimal"
                  step="2.5"
                  value={anchor}
                  onChange={(e) => setAnchor(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && canAdvance) next() }}
                  placeholder="100"
                  className="flex-1 text-2xl font-semibold text-[#111111] outline-none bg-transparent"
                />
                <span className="text-base text-[#aaaaaa]">kg</span>
              </div>
            </Question>
          )}

          {/* Step 8: target weight */}
          {step === 8 && (
            <Question
              label="what's your goal weight?"
              hint="the number on the bar you want to hit. doesn't have to be realistic right now."
            >
              {targetSuggestions.length > 0 && (
                <div className="flex gap-2 mb-6">
                  {targetSuggestions.map(({ kg, label }) => (
                    <button
                      key={kg}
                      onClick={() => setTarget(String(kg))}
                      className={`flex-1 flex flex-col items-center py-3 rounded-xl border-2 transition-colors ${
                        target === String(kg)
                          ? "border-[#1e3a5f] bg-[#eff6ff] text-[#1e3a5f]"
                          : "border-[#e8e8e8] text-[#111111] hover:border-[#cccccc]"
                      }`}
                    >
                      <span className="text-base font-semibold">{kg}kg</span>
                      <span className="text-xs text-[#aaaaaa] mt-0.5">{label}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-baseline gap-2 border-b-2 border-[#e8e8e8] focus-within:border-[#1e3a5f] pb-2">
                <input
                  type="number"
                  inputMode="decimal"
                  step="2.5"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && canAdvance) next() }}
                  placeholder="140"
                  className="flex-1 text-2xl font-semibold text-[#111111] outline-none bg-transparent"
                />
                <span className="text-base text-[#aaaaaa]">kg</span>
              </div>
            </Question>
          )}

          {/* Step 9: commitment gate — label then hint, buttons appear after animation */}
          {step === LAST_STEP && (
            <Question
              label="only do this if you're actually going to show up."
              hint="no judgment. but this only works if you use it."
              highlight
              onHighlightComplete={() => setReadUnlocked(true)}
            >
              <div className={`transition-opacity duration-500 ${readUnlocked ? "opacity-100" : "opacity-0"}`}>
                <button
                  onClick={handleGoogleSignIn}
                  disabled={!readUnlocked}
                  className="w-full flex items-center justify-center gap-3 border border-[#e8e8e8] rounded-xl py-3.5 text-sm font-semibold text-[#111111] hover:bg-[#fafafa] active:bg-[#f5f5f5] transition-colors mt-4"
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                    <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
                    <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.583-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
                    <path fill="#FBBC05" d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z"/>
                    <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.165 6.656 3.58 9 3.58z"/>
                  </svg>
                  sign in with google
                </button>
                <button
                  onClick={back}
                  disabled={!readUnlocked}
                  className="w-full text-center text-sm text-[#aaaaaa] hover:text-[#777777] mt-4 py-2"
                >
                  back
                </button>
              </div>
            </Question>
          )}

        </div>
      </div>

      {/* Footer — hidden on the sign-in step */}
      {step !== LAST_STEP && (
        <div className="px-6 pb-10 pt-6">
          <div className="max-w-[360px] mx-auto flex items-center gap-3">
            {step > 0 && (
              <button
                onClick={back}
                className="text-sm font-semibold text-[#777777] hover:text-[#111111] px-4 py-3"
              >
                back
              </button>
            )}
            <button
              onClick={next}
              disabled={!canAdvance}
              className="flex-1 bg-[#1e3a5f] text-white text-sm font-semibold rounded-xl py-3.5 hover:bg-[#16304f] active:bg-[#0f2540] transition-colors disabled:opacity-40"
            >
              continue
            </button>
          </div>
        </div>
      )}
    </main>
  )
}

const PHASES = [
  { color: "#2d6a2d", name: "volume",    desc: "more reps, lighter. build the base. about 2 weeks." },
  { color: "#5a2d8a", name: "intensity", desc: "fewer reps, heavier. about 1½ weeks." },
  { color: "#1e3a5f", name: "peak",      desc: "taper, then test a new max. about 1 week." },
  { color: "#888888", name: "deload",    desc: "back off. let it sink in. a session or two." },
] as const

function PhasesReveal({ started, onComplete }: { started: boolean; onComplete?: () => void }) {
  const [labelsVisible, setLabelsVisible] = useState(false)
  const [descsVisible, setDescsVisible] = useState(false)

  useEffect(() => {
    if (!started) return
    let r2: number
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => setLabelsVisible(true))
    })
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2) }
  }, [started])

  return (
    <div className="mt-2">
      <div className="space-y-4">
        {PHASES.map(({ color, name, desc }, i) => (
          <div key={name} className="flex items-start gap-3">
            <div
              style={{ transitionDelay: `${i * 500}ms`, backgroundColor: color }}
              className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 transition-opacity duration-500 ${labelsVisible ? "opacity-100" : "opacity-0"}`}
            />
            <div>
              <span
                style={{ transitionDelay: `${i * 500}ms` }}
                className={`text-sm font-semibold text-[#111111] transition-opacity duration-500 ${labelsVisible ? "opacity-100" : "opacity-0"}`}
                onTransitionEnd={i === PHASES.length - 1 ? (e) => {
                  if (e.propertyName === "opacity") setDescsVisible(true)
                } : undefined}
              >
                {name}
              </span>
              {descsVisible && (
                <DescSpan delay={i * 150}>{" — "}{desc}</DescSpan>
              )}
            </div>
          </div>
        ))}
      </div>
      <p
        style={{ transitionDelay: `${PHASES.length * 150}ms` }}
        className={`mt-6 text-sm text-[#777777] transition-opacity duration-500 ${descsVisible ? "opacity-100" : "opacity-0"}`}
        onTransitionEnd={(e) => { if (e.propertyName === "opacity") onComplete?.() }}
      >
        then you reset and go again — heavier than before.
      </p>
    </div>
  )
}

function DescSpan({ children, delay }: { children: React.ReactNode; delay: number }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    let r2: number
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => setVisible(true))
    })
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2) }
  }, [])
  return (
    <span
      style={{ transitionDelay: `${delay}ms`, opacity: visible ? 1 : 0 }}
      className="text-sm text-[#777777] transition-opacity duration-500"
    >
      {children}
    </span>
  )
}

// Words fade in with CSS stagger — no interval ticking, all words cascade continuously
function RevealText({
  text,
  speed = 180,
  started = true,
  onComplete,
}: {
  text: string
  speed?: number
  started?: boolean
  onComplete?: () => void
}) {
  const words = text.split(" ")
  const [active, setActive] = useState(false)

  useEffect(() => {
    if (!started) return
    // Double RAF ensures opacity-0 is painted before the transition begins
    let raf2: number
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setActive(true))
    })
    const totalMs = (words.length - 1) * speed + 600
    const id = setTimeout(() => onComplete?.(), totalMs)
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      clearTimeout(id)
      // Reset on the way out, so the next start fades in from opacity-0 again.
      setActive(false)
    }
  }, [text, started]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {words.map((word, i) => (
        <span
          key={i}
          style={{ transitionDelay: `${i * speed}ms` }}
          className={`transition-opacity duration-500 ${active ? "opacity-100" : "opacity-0"}`}
        >
          {word}
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </>
  )
}

function Question({
  label,
  hint,
  children,
  highlight,
  onHighlightComplete,
}: {
  label: string
  hint?: string
  children?: React.ReactNode | ((bodyVisible: boolean, onBodyComplete?: () => void) => React.ReactNode)
  highlight?: boolean
  onHighlightComplete?: () => void
}) {
  const [labelDone, setLabelDone] = useState(false)

  const handleLabelComplete = () => {
    setLabelDone(true)
    // If no hint and no render-prop body, unlock immediately after label
    if (!hint && typeof children !== "function") {
      onHighlightComplete?.()
    }
  }

  // Render-prop children receive (bodyVisible, onBodyComplete) so they can
  // control when the gate fires after the last body item transitions in
  const resolvedChildren =
    typeof children === "function" ? children(labelDone, onHighlightComplete) : children

  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-tight mb-2 leading-snug">
        {highlight ? (
          <RevealText text={label} onComplete={handleLabelComplete} />
        ) : (
          <span className="text-[#111111]">{label}</span>
        )}
      </h2>
      {hint && (
        <p className="text-sm text-[#777777] mb-8">
          {highlight ? (
            <RevealText text={hint} started={labelDone} onComplete={onHighlightComplete} />
          ) : (
            hint
          )}
        </p>
      )}
      {resolvedChildren}
    </div>
  )
}
