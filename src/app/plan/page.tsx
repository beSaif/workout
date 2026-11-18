"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { MAIN_LIFT_LABEL } from "@/lib/types"
import { isLiftFocused } from "@/lib/trainingMode"
import {
  applyRoutinePlan,
  exerciseConfigCache,
  loadExerciseConfig,
  loadTrainingDays,
  profileCache,
  routineSnapshotCache,
  trainingDaysCache,
  undoRoutinePlan,
} from "@/lib/storage"
import { useCachedState, useHydrated, useLocalValue } from "@/lib/useLocalValue"
import { RoutinePlan, exportPlan, readPlanText, resolvePlan } from "@/lib/routinePlan"
import { PLAN_NOTE_MAX, PLAN_QUESTIONS, PlanAnswers, PlanContext, buildCopyPrompt } from "@/lib/planPrompt"
import { afterHapticTap, haptic } from "@/lib/haptics"
import { useOnboardingGuard } from "@/lib/useOnboardingGuard"
import RoutinePreview from "@/components/RoutinePreview"
import DotFace from "@/components/buddy/DotFace"
import HapticTap from "@/components/HapticTap"
import BackButton from "@/components/BackButton"
import { useConfirm } from "@/components/ConfirmSheet"

const SECTION_LABEL = "text-[10px] font-semibold uppercase tracking-widest text-ink-6 mb-3"
const PRIMARY =
  "relative w-full rounded-xl bg-brand-fill py-3 text-sm font-semibold text-white hover:bg-brand-fill-2 transition-colors disabled:opacity-40"
const SECONDARY =
  "w-full rounded-xl border border-line bg-surface py-3 text-sm font-semibold text-brand hover:border-brand-line transition-colors disabled:opacity-40"
const TEXT_LINK = "text-xs font-semibold text-ink-5 hover:text-ink-2 transition-colors"

function chipClass(on: boolean) {
  return `px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
    on
      ? "bg-brand-fill text-white border-brand-line"
      : "bg-surface text-ink-5 border-line hover:border-brand-line hover:text-brand"
  }`
}

interface PlannerStatus {
  available: boolean
  remaining: number
  limit: number
  following: boolean
  athleteCount: number
}

type Step = "start" | "questions" | "thinking" | "paste" | "review" | "done"

interface Proposal {
  plan: RoutinePlan
  warnings: string[]
  source: "dot" | "paste"
}

const DOT_ERRORS: Record<string, string> = {
  limit: "That's all of Dot's plans for today. Try again tomorrow, or plan with your own AI below.",
  busy: "Dot's planner is busy right now. Give it a minute, or plan with your own AI below.",
  "bad-plan": "Dot couldn't come up with a plan that fits. Try again, or change your answers.",
  following: "You're following a coach's routine, so it can't be replaced here.",
  unavailable: "Dot's planner isn't switched on for this app. You can still plan with your own AI.",
}

/** A list of names that stays one line long. */
function nameList(names: string[], max = 5): string {
  return names.length <= max ? names.join(", ") : `${names.slice(0, max).join(", ")} and ${names.length - max} more`
}

/**
 * The routine planner: Dot drafts a split from five questions, or the user brings one
 * from their own chatbot by copy and paste. Either way the plan is previewed against
 * the current routine — what's new, what's retired, what starts without history — and
 * nothing changes until it is applied, which can be undone.
 */
export default function PlanPage() {
  const { confirm, confirmSheet } = useConfirm()
  useOnboardingGuard()
  const mounted = useHydrated()
  const [cachedConfig, setConfig] = useCachedState(exerciseConfigCache)
  const [cachedDays, setDays] = useCachedState(trainingDaysCache)
  const config = useMemo(() => cachedConfig ?? [], [cachedConfig])
  const days = useMemo(() => cachedDays ?? [], [cachedDays])
  const profile = useLocalValue(profileCache)
  const ctx = useMemo<PlanContext>(
    () => (isLiftFocused(profile ?? null) && profile?.mainLift ? { mainLift: MAIN_LIFT_LABEL[profile.mainLift] } : {}),
    [profile]
  )
  // Applying a plan saves the snapshot and undoing clears it, so this follows by itself.
  const canUndo = useLocalValue(routineSnapshotCache) != null
  const [status, setStatus] = useState<PlannerStatus | null>(null)
  const [step, setStep] = useState<Step>("start")

  const [answers, setAnswers] = useState<Partial<PlanAnswers>>({})
  const [note, setNote] = useState("")
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [tweak, setTweak] = useState("")
  const [dotError, setDotError] = useState<string | null>(null)

  const [pasted, setPasted] = useState("")
  const [pasteErrors, setPasteErrors] = useState<string[]>([])
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle")

  useEffect(() => {
    loadExerciseConfig().then(setConfig)
    loadTrainingDays().then(setDays)
    fetch("/api/plan")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: PlannerStatus | null) => setStatus(data))
      .catch(() => setStatus(null))
  }, [setConfig, setDays])

  const resolved = useMemo(
    () => (proposal ? resolvePlan(proposal.plan, config, days) : null),
    [proposal, config, days]
  )

  const allAnswered = PLAN_QUESTIONS.every((q) => answers[q.key])
  const dotOn = status?.available === true
  const locked = status?.following === true

  async function askDot(tweakRequest?: string) {
    if (!allAnswered) return
    setDotError(null)
    setStep("thinking")
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: { ...answers, note: note.trim() || undefined },
          tweak: tweakRequest && proposal ? { plan: proposal.plan, request: tweakRequest } : undefined,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.plan) {
        if (typeof data?.remaining === "number") setStatus((s) => (s ? { ...s, remaining: data.remaining } : s))
        setDotError(DOT_ERRORS[data?.error] ?? "Something went wrong. Check your connection and try again.")
        setStep(proposal && tweakRequest ? "review" : "questions")
        return
      }
      setStatus((s) => (s ? { ...s, remaining: data.remaining } : s))
      setProposal({ plan: data.plan, warnings: data.warnings ?? [], source: "dot" })
      setTweak("")
      setStep("review")
    } catch {
      setDotError("Couldn't reach Dot. Check your connection and try again.")
      setStep(proposal && tweakRequest ? "review" : "questions")
    }
  }

  async function copyPrompt() {
    const prompt = buildCopyPrompt(exportPlan(config, days), ctx)
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied("done")
    } catch {
      setCopied("failed")
    }
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText()
      setPasted(text)
      readPasted(text)
    } catch {
      setPasteErrors(["Couldn't read the clipboard. Long-press the box above and paste instead."])
    }
  }

  function readPasted(text = pasted) {
    const result = readPlanText(text)
    if (!result.ok) {
      setPasteErrors(result.errors)
      return
    }
    setPasteErrors([])
    setProposal({ plan: result.plan, warnings: result.warnings, source: "paste" })
    setStep("review")
  }

  async function apply() {
    if (!resolved) return
    if (status && status.athleteCount > 0) {
      const n = status.athleteCount
      const yes = await confirm({
        title: "Apply this routine?",
        body: `${n} athlete${n === 1 ? " trains" : "s train"} under you and will get this routine too.`,
        confirmLabel: "Apply routine",
      })
      if (!yes) return
    }
    haptic("exercise")
    applyRoutinePlan({ config: resolved.config, days: resolved.days }, { config, days })
    // The button goes away with the step, and on an iPhone its tick needs it a moment longer.
    afterHapticTap(() => {
      setConfig(resolved.config)
      setDays(resolved.days)
      setStep("done")
    })
  }

  async function undo() {
    const yes = await confirm({
      title: "Put your routine back?",
      body: "It returns to how it was before this plan. Changes made since are lost.",
      confirmLabel: "Restore routine",
      destructive: true,
    })
    if (!yes) return
    const restored = undoRoutinePlan(config)
    if (!restored) return
    setConfig(restored.config)
    setDays(restored.days)
    setProposal(null)
    setStep("start")
  }

  if (!mounted) {
    return (
      <main className="mx-auto w-full max-w-[393px] px-4 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-6">
        <div className="h-4 w-16 bg-surface-4 rounded animate-pulse mb-8" />
        <div className="h-6 w-48 bg-surface-4 rounded animate-pulse mb-6" />
        <div className="h-32 bg-surface-4 rounded-xl animate-pulse" />
      </main>
    )
  }

  const back =
    step === "start" || step === "done" ? (
      <BackButton href="/exercises" label="Back to routine" className="mb-3" />
    ) : (
      <BackButton
        onClick={() => setStep(step === "review" && proposal?.source === "paste" ? "paste" : "start")}
        disabled={step === "thinking"}
        label="Back"
        className="mb-3"
      />
    )

  return (
    <main className="mx-auto w-full max-w-[393px] px-4 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(4rem+env(safe-area-inset-bottom))]">
      {confirmSheet}
      {back}

      <div className="flex items-end gap-3 mb-1">
        <DotFace thinking={step === "thinking"} happy={step === "done"} />
        <h1 className="text-2xl font-semibold text-ink tracking-tight leading-none">Plan your routine</h1>
      </div>
      <p className="text-sm text-ink-5 mt-2 mb-6">
        {step === "thinking"
          ? "Dot is putting your split together…"
          : step === "done"
            ? "Done. Your training days now follow the new plan."
            : "Your days, muscle groups and exercises, planned for you. Nothing changes until you apply it."}
      </p>

      {locked && (
        <div className="bg-brand-tint-2 border border-brand-line-2 rounded-xl px-4 py-3 mb-6 text-sm text-ink">
          You&apos;re following a coach&apos;s routine, so it can&apos;t be replaced. Stop training under them on the{" "}
          <Link href="/exercises" className="font-semibold text-brand hover:underline">
            Routine
          </Link>{" "}
          page first.
        </div>
      )}

      {/* ─── Start ─── */}
      {step === "start" && !locked && (
        <div className="space-y-3">
          {dotOn && (
            <button
              onClick={() => setStep("questions")}
              className="w-full text-left bg-surface border border-line rounded-xl px-4 py-4 hover:border-brand-line transition-colors"
            >
              <p className="text-sm font-semibold text-ink">Plan with Dot</p>
              <p className="text-xs text-ink-5 mt-0.5">
                Answer five quick questions and Dot drafts a split around your current routine.
              </p>
              <p className="text-[11px] text-ink-6 mt-2">
                {status.remaining > 0
                  ? `${status.remaining} of ${status.limit} plans left today`
                  : "No plans left today. Back tomorrow."}
              </p>
            </button>
          )}
          <button
            onClick={() => setStep("paste")}
            className="w-full text-left bg-surface border border-line rounded-xl px-4 py-4 hover:border-brand-line transition-colors"
          >
            <p className="text-sm font-semibold text-ink">Use your own AI</p>
            <p className="text-xs text-ink-5 mt-0.5">
              Copy a prompt into ChatGPT, Claude or Gemini, talk it through, and paste the plan back here.
            </p>
          </button>
          {canUndo && (
            <button onClick={undo} className={`${TEXT_LINK} pt-2`}>
              Undo the last plan you applied
            </button>
          )}
        </div>
      )}

      {/* ─── Dot's questions ─── */}
      {step === "questions" && !locked && (
        <>
          {PLAN_QUESTIONS.map((q) => (
            <div key={q.key} className="mb-5">
              <p className="text-sm font-semibold text-ink mb-2">{q.question}</p>
              <div className="flex flex-wrap gap-2">
                {q.options.map((o) => (
                  <button
                    key={o.value}
                    onClick={() => setAnswers((a) => ({ ...a, [q.key]: o.value }))}
                    aria-pressed={answers[q.key] === o.value}
                    className={chipClass(answers[q.key] === o.value)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="text-sm font-semibold text-ink mb-2">
            Anything else? <span className="font-normal text-ink-6">Optional</span>
          </p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, PLAN_NOTE_MAX))}
            rows={3}
            placeholder="Injuries, exercises to keep or avoid, muscles to bring up…"
            className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-brand-line resize-none mb-5"
          />
          {dotError && <p className="text-xs text-red-500 mb-3">{dotError}</p>}
          <button
            onClick={() => askDot()}
            disabled={!allAnswered || (status?.remaining ?? 0) <= 0}
            className={PRIMARY}
          >
            Make my plan
          </button>
          <p className="text-[11px] text-ink-6 mt-2 text-center">
            Dot sends only your routine and these answers to its AI model.
          </p>
        </>
      )}

      {/* ─── Thinking ─── */}
      {step === "thinking" && (
        <div className="space-y-2" aria-live="polite">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 bg-surface-3 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {/* ─── Copy and paste ─── */}
      {step === "paste" && !locked && (
        <>
          <p className={SECTION_LABEL}>1 · Copy the prompt</p>
          <p className="text-xs text-ink-5 mb-3">
            It carries your current routine and the rules the app needs. Paste it into a new chat; the AI asks you a
            few questions, then writes the plan.
          </p>
          <button onClick={copyPrompt} className={`${SECONDARY} mb-2`}>
            {copied === "done" ? "Copied ✓" : "Copy prompt"}
          </button>
          {copied === "failed" && (
            <textarea
              readOnly
              value={buildCopyPrompt(exportPlan(config, days), ctx)}
              onFocus={(e) => e.currentTarget.select()}
              rows={6}
              aria-label="Prompt to copy"
              className="w-full rounded-xl border border-line bg-surface-1 px-3 py-2.5 text-[11px] text-ink-4 font-mono mb-2"
            />
          )}

          <p className={`${SECTION_LABEL} mt-6`}>2 · Paste the plan back</p>
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={6}
            placeholder="Paste the AI's whole reply here. The JSON inside is all that's read."
            aria-label="Plan to import"
            className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-xs text-ink font-mono outline-none focus:border-brand-line resize-none mb-3"
          />
          {pasteErrors.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 mb-3">
              <p className="text-xs font-semibold text-red-600 mb-1">This plan can&apos;t be used yet</p>
              <ul className="space-y-0.5">
                {pasteErrors.map((e) => (
                  <li key={e} className="text-xs text-red-600">
                    {e}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-red-400 mt-1.5">Paste this back to the AI and ask it to fix it.</p>
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={pasteFromClipboard} className={SECONDARY}>
              Paste
            </button>
            <button onClick={() => readPasted()} disabled={!pasted.trim()} className={PRIMARY}>
              Check plan
            </button>
          </div>
        </>
      )}

      {/* ─── Review ─── */}
      {step === "review" && resolved && proposal && !locked && (
        <>
          <Changes changes={resolved.changes} warnings={proposal.warnings} />

          <p className={SECTION_LABEL}>The new routine</p>
          <RoutinePreview routine={resolved.bundle} />

          {dotError && <p className="text-xs text-red-500 mb-3">{dotError}</p>}
          <button onClick={apply} disabled={resolved.changes.unchanged} className={PRIMARY}>
            Use this plan
            <HapticTap />
          </button>

          {proposal.source === "dot" && (
            <div className="mt-6">
              <p className={SECTION_LABEL}>Not quite?</p>
              <textarea
                value={tweak}
                onChange={(e) => setTweak(e.target.value.slice(0, PLAN_NOTE_MAX))}
                rows={2}
                placeholder="e.g. Swap leg press for squats, and more back work"
                className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-brand-line resize-none mb-2"
              />
              <button
                onClick={() => askDot(tweak.trim())}
                disabled={!tweak.trim() || (status?.remaining ?? 0) <= 0}
                className={SECONDARY}
              >
                Ask Dot to change it
              </button>
              {status && (
                <p className="text-[11px] text-ink-6 mt-2 text-center">
                  {status.remaining > 0 ? `${status.remaining} left today` : "No plans left today"}
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* ─── Done ─── */}
      {step === "done" && (
        <div className="space-y-3">
          <Link href="/exercises" className={`${PRIMARY} block text-center`}>
            See my routine
          </Link>
          <Link href="/" className={`${SECONDARY} block text-center`}>
            Home
          </Link>
          {canUndo && (
            <button onClick={undo} className={`${TEXT_LINK} pt-2`}>
              Undo, put my old routine back
            </button>
          )}
        </div>
      )}
    </main>
  )
}

function Changes({ changes, warnings }: { changes: ReturnType<typeof resolvePlan>["changes"]; warnings: string[] }) {
  if (changes.unchanged) {
    return (
      <div className="rounded-xl bg-surface-1 px-4 py-3 mb-6 text-sm text-ink-4">
        This is the same as your current routine.
      </div>
    )
  }
  const rows: { label: string; value: string; tone?: "muted" }[] = []
  const before = changes.daysBefore.join(", ") || "none"
  const after = changes.daysAfter.join(", ")
  rows.push({ label: "Days", value: before === after ? after : `${before} → ${after}` })
  if (changes.groupsAdded.length) rows.push({ label: "New groups", value: nameList(changes.groupsAdded) })
  if (changes.groupsRenamed.length) {
    rows.push({ label: "Renamed", value: changes.groupsRenamed.map((r) => `${r.from} → ${r.to}`).join(", ") })
  }
  if (changes.groupsRemoved.length) {
    rows.push({ label: "Retired", value: `${nameList(changes.groupsRemoved)}. Past sessions keep their names.`, tone: "muted" })
  }
  if (changes.exercisesAdded.length) {
    rows.push({ label: "New exercises", value: `${nameList(changes.exercisesAdded)}. These start without history.` })
  }
  if (changes.exercisesRemoved.length) {
    rows.push({ label: "Dropped", value: `${nameList(changes.exercisesRemoved)}. Their history stays.`, tone: "muted" })
  }

  return (
    <div className="mb-6">
      <p className={SECTION_LABEL}>What changes</p>
      <div className="bg-surface border border-line rounded-xl divide-y divide-line-soft">
        {rows.map((r) => (
          <div key={r.label} className="px-4 py-2.5">
            <p className="text-[11px] font-semibold text-ink-6">{r.label}</p>
            <p className={`text-[13px] mt-0.5 ${r.tone === "muted" ? "text-ink-5" : "text-ink"}`}>{r.value}</p>
          </div>
        ))}
      </div>
      {warnings.length > 0 && (
        <ul className="mt-3 space-y-1">
          {warnings.map((w) => (
            <li key={w} className="text-xs text-amber-700">
              {w}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
