"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Session, TrainingBlock, BlockPhase, MuscleGroup, UserProfile, UserPresence, GymbroMessage, WeightEntry } from "@/lib/types"
import { isLiftFocused, getMainLiftLabel, getMainLiftShortLabel, countConsecutiveSkips, currentStretchSkips } from "@/lib/trainingMode"
import { loadSessionsLocal, loadBlocksLocal, loadExerciseConfigLocal, loadTrainingDaysLocal, loadAll, loadExerciseConfig, loadTrainingDays, saveAll, loadDraft, clearDraft, loadProfile, loadProfileLocal, loadPresencesLocal, savePresencesLocal, loadFriendEmailsLocal, saveFriendEmailsLocal, loadFriendLastActiveLocal, saveFriendLastActiveLocal, clearMiniPlayer, loadLayoffDismissLocal, saveLayoffDismissLocal, loadWeights, loadWeightsLocal, saveWeights, loadWeighInSkipLocal, saveWeighInSkipLocal } from "@/lib/storage"
import type { SessionDraft } from "@/lib/types"
import {
  prescribeBlockSession,
  prescribeForBlock,
  getBlockLength,
  blockPosition,
  blockSlotNumbers,
  migrateSessionTypes,
  cycleLoadOffset,
  blockLengthFor,
  measureSessionsPerWeek,
  PHASE_LABEL,
  PHASE_SESSION_TYPE,
  type Prescription,
} from "@/lib/prescription"
import { generateWarmups } from "@/lib/warmup"
import { closeBlock, jumpToSession, peekNextBlock, JumpTarget } from "@/lib/jump"
import { getLayoffState, layoffAnchor, restartActiveBlock } from "@/lib/layoff"
import { scheduleIncompleteSessionReminder, cancelIncompleteSessionReminder } from "@/lib/swNotify"
import { calcE1RM, roundToPlate } from "@/lib/e1rm"
import { MuscleGroupConfig, DEFAULT_MUSCLE_GROUPS, DEFAULT_TRAINING_DAYS } from "@/lib/exerciseConfig"
import { TrainingDay } from "@/lib/types"
import SessionCard from "@/components/SessionCard"
import PreviewSessionRow from "@/components/PreviewSessionRow"
import BlockHeader from "@/components/BlockHeader"
import ProgramTimeline from "@/components/ProgramTimeline"
import StatsGrid from "@/components/StatsGrid"
import ProgressBar from "@/components/ProgressBar"
import LogSessionModal from "@/components/LogSessionModal"
import NavDrawer from "@/components/NavDrawer"
import InstallGuideModal, { useInstallGuide } from "@/components/InstallGuideModal"
import WhatsNewModal, { useWhatsNew } from "@/components/WhatsNewModal"
import GymbrosTimeline from "@/components/GymbrosTimeline"
import FriendMessagePopup from "@/components/FriendMessagePopup"
import HypePanelModal from "@/components/HypePanelModal"
import ShareImageModal from "@/components/ShareImageModal"
import BalancedHome from "@/components/balanced/BalancedHome"
import LayoffBanner from "@/components/LayoffBanner"
import DotBuddy from "@/components/buddy/DotBuddy"
import { buildDotCue } from "@/lib/buddy"
import WeightCard from "@/components/WeightCard"
import WeightCheckInSheet from "@/components/WeightCheckInSheet"
import WeightOptInSheet, { useWeightOptIn } from "@/components/WeightOptInSheet"
import { bwForSession, dateKey, upsertEntry, weighInDue } from "@/lib/weight"
import { getBestE1RM, getBestWeight, getLatestBW } from "@/lib/stats"
import { suggestNextDay } from "@/lib/balance"
import { relativeTime } from "@/lib/time"

const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000
/** Days away after which Dot is found asleep when the app opens. */
const DOT_ASLEEP_AFTER_DAYS = 5

function getActiveBlock(blocks: TrainingBlock[]): TrainingBlock | undefined {
  return blocks.find((b) => b.status === "active")
}


function createUpcomingSession(
  sessions: Session[],
  blocks: TrainingBlock[],
  config: MuscleGroupConfig[],
  profile: UserProfile,
  trainingDays: TrainingDay[] = DEFAULT_TRAINING_DAYS
): Session {
  const maxIdAll = sessions.length > 0 ? Math.max(...sessions.map((s) => s.id)) : 0
  const nextDayAll = suggestNextDay(sessions, trainingDays, config)?.day

  // Balanced mode: no main lift, no block. The upcoming card is just the next training day.
  if (!isLiftFocused(profile)) {
    return {
      id: maxIdAll + 1,
      date: null,
      type: "Free",
      bw: null,
      sets: [],
      confirmed: false,
      coachNote: "",
      selectedTrainingDayId: nextDayAll?.id,
      selectedMuscleGroups: nextDayAll?.muscleGroupIds ?? [],
    }
  }

  const activeBlock = getActiveBlock(blocks)

  let prescription: Prescription
  let blockId: number | undefined

  if (activeBlock) {
    const sessionIndexInBlock = blockPosition(activeBlock)
    prescription = prescribeForBlock(activeBlock, sessionIndexInBlock, cycleLoadOffset(blocks, sessions, activeBlock))
    blockId = activeBlock.id
  } else {
    prescription = prescribeBlockSession("accumulation", 0, profile.anchor ?? 0)
  }

  const warmups = generateWarmups(prescription.weight, prescription.reps)
  const workingSets = Array.from({ length: prescription.sets }, (_, i) => ({
    id: `S${i + 1}`,
    kg: prescription.weight,
    reps: prescription.reps,
    rpe: null as null,
    e1rm: calcE1RM(prescription.weight, prescription.reps),
    note: "",
    isWarmup: false,
  }))
  const maxId = sessions.length > 0 ? Math.max(...sessions.map((s) => s.id)) : 0

  const sessionIndex = activeBlock ? blockPosition(activeBlock) : 0
  const phase = activeBlock?.phase ?? "accumulation"
  const blockLength = activeBlock ? getBlockLength(activeBlock) : blockLengthFor("accumulation", measureSessionsPerWeek(sessions, null))
  const effort = prescription.rpe != null ? ` ${prescription.light ? "Light day, aim" : "Aim"} for RPE ${prescription.rpe}.` : ""
  const coachNote = `[${PHASE_LABEL[phase]} ${sessionIndex + 1}/${blockLength}] ${prescription.weight}kg × ${prescription.reps} × ${prescription.sets}.${effort} Stay tight, drive the bar.`

  const nextDay = suggestNextDay(sessions, trainingDays, config)?.day

  return {
    id: maxId + 1,
    date: null,
    type: prescription.sessionType,
    bw: null,
    confirmed: false,
    coachNote,
    sets: [...warmups, ...workingSets],
    selectedTrainingDayId: nextDay?.id,
    selectedMuscleGroups: nextDay?.muscleGroupIds ?? [],
    blockId,
  }
}

/**
 * The upcoming card must match the current training mode: a Free card in Balanced mode,
 * a prescribed one in lift-focused mode. A mismatch means the user switched modes since
 * the card was generated, so it needs regenerating.
 *
 * A lift-focused card whose main lift was skipped is stored as Free too, but that is a
 * deliberate choice for today rather than a stale card — it stays as it is.
 */
function upcomingMatchesMode(upcoming: Session | undefined, profile: UserProfile): boolean {
  if (!upcoming) return false
  if (isLiftFocused(profile)) return upcoming.skippedMainLift === true || upcoming.type !== "Free"
  return upcoming.type === "Free"
}

/** A block slot by phase and place, e.g. "Intensity 3" — what the program calls it. */
function slotLabel(phase: BlockPhase, index: number): string {
  const name = phase === "reacclimation" ? PHASE_LABEL[phase] : PHASE_SESSION_TYPE[phase]
  return `${name} ${index + 1}`
}

function countSkippedSlots(blocks: TrainingBlock[]): number {
  return blocks.reduce((n, b) => n + (b.skippedSlots?.length ?? 0), 0)
}

/** The prescribed opener of an upcoming session, e.g. "62.5kg × 6 × 4". */
function describePrescription(session: Session): string | null {
  const working = session.sets.filter((s) => !s.isWarmup)
  const top = working[0]
  return top ? `${top.kg}kg × ${top.reps} × ${working.length}` : null
}

function backfillMuscles(sessions: Session[], config: MuscleGroupConfig[], trainingDays: TrainingDay[] = DEFAULT_TRAINING_DAYS): Session[] {
  const upcoming = sessions.find((s) => !s.confirmed)
  if (!upcoming || upcoming.selectedMuscleGroups !== undefined) return sessions
  const nextDay = suggestNextDay(sessions, trainingDays, config)?.day
  return sessions.map((s) =>
    s.id === upcoming.id
      ? { ...s, selectedTrainingDayId: nextDay?.id, selectedMuscleGroups: nextDay?.muscleGroupIds ?? [] }
      : s
  )
}

function sortSessions(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => {
    if (!a.confirmed) return -1
    if (!b.confirmed) return 1
    return new Date(b.date!).getTime() - new Date(a.date!).getTime()
  })
}

export default function Page() {
  const router = useRouter()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [blocks, setBlocks] = useState<TrainingBlock[]>([])
  const [exerciseConfig, setExerciseConfig] = useState<MuscleGroupConfig[]>(DEFAULT_MUSCLE_GROUPS)
  const [trainingDays, setTrainingDays] = useState<TrainingDay[]>(DEFAULT_TRAINING_DAYS)
  const [loggingSession, setLoggingSession] = useState<Session | null>(null)
  const [activeDraft, setActiveDraft] = useState<SessionDraft | null>(null)
  const [draftPrompt, setDraftPrompt] = useState<{ session: Session; draft: SessionDraft } | null>(null)
  const [editingSession, setEditingSession] = useState<Session | null>(null)
  const [anchorPrompt, setAnchorPrompt] = useState(false)
  const [anchorInput, setAnchorInput] = useState("")
  const [mounted, setMounted] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [presences, setPresences] = useState<UserPresence[]>(() => loadPresencesLocal())
  const [friendEmails, setFriendEmails] = useState<Set<string>>(() => new Set(loadFriendEmailsLocal()))
  const [friendLastActive, setFriendLastActive] = useState<Record<string, string>>(() => loadFriendLastActiveLocal())
  const [friendProfiles, setFriendProfiles] = useState<UserProfile[]>([])
  const [showHypePanel, setShowHypePanel] = useState(false)
  const [lastConfirmed, setLastConfirmed] = useState<Session | null>(null)
  const [lastPR, setLastPR] = useState<{ e1rm: number; previous: number } | null>(null)
  const [shareSession, setShareSession] = useState<Session | null>(null)
  const [messagesByFriend, setMessagesByFriend] = useState<Record<string, GymbroMessage[]>>({})
  const [msgPopupFriend, setMsgPopupFriend] = useState<UserPresence | null>(null)
  const [msgPopupMessages, setMsgPopupMessages] = useState<GymbroMessage[]>([])
  const friendEmailsRef = useRef<Set<string>>(new Set(loadFriendEmailsLocal()))
  const [toasts, setToasts] = useState<Array<{ id: string; name: string }>>([])
  const prevPresencesRef = useRef<UserPresence[]>([])
  const [showNotifBanner, setShowNotifBanner] = useState(false)
  // Which layoff banner the user already dismissed, so it doesn't nag every load.
  const [layoffDismissed, setLayoffDismissed] = useState<string | null>(() => loadLayoffDismissLocal())
  const presenceInitialisedRef = useRef(false)
  const [viewingBlockId, setViewingBlockId] = useState<number | null>(null)
  const [viewingUpcomingPhase, setViewingUpcomingPhase] = useState<BlockPhase | null>(null)
  // The last jump, kept so it can be undone while the blocks are still as it left them.
  // Not persisted: once the page reloads or anything moves the blocks, the jump stands.
  const [jumpUndo, setJumpUndo] = useState<{
    before: TrainingBlock[]
    after: TrainingBlock[]
    upcoming: Session
    label: string
  } | null>(null)
  const [weights, setWeights] = useState<WeightEntry[]>([])
  /**
   * False until there is a weight log worth drawing: the local copy if it has entries,
   * otherwise KV's answer. Until then the card shows a placeholder, not "log your first
   * weigh-in" for someone whose history simply hasn't arrived yet.
   */
  const [weightsReady, setWeightsReady] = useState(false)
  /**
   * The open check-in sheet, or null when it is closed. `prompted` means the weekly
   * prompt opened it rather than the +, so closing it skips the week.
   */
  const [checkIn, setCheckIn] = useState<{ day: string; prompted: boolean } | null>(null)
  const installGuide = useInstallGuide()
  const whatsNew = useWhatsNew()
  const weightOptIn = useWeightOptIn(setProfile)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFired = useRef(false)
  const sessionsRef = useRef<Session[]>([])

  function handleTitlePointerDown() {
    longPressFired.current = false
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true
      window.location.href = "/dev"
    }, 800)
  }

  // Short tap on the title opens the profile; long-press (800ms) opens dev tools.
  function handleTitlePointerUp() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
      if (!longPressFired.current) router.push("/profile")
    }
  }

  // Pointer left the title before release — cancel without navigating.
  function handleTitlePointerCancel() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  useEffect(() => {
    let cancelled = false

    // Fast path: render from localStorage immediately to avoid flicker on re-navigation
    const cachedProfile = loadProfileLocal()
    if (cachedProfile) {
      const localSessions = loadSessionsLocal()
      const localBlocks = loadBlocksLocal()
      const localConfig = loadExerciseConfigLocal()
      const localDays = loadTrainingDaysLocal()
      setProfile(cachedProfile)
      if (localSessions.length > 0) setSessions(backfillMuscles(localSessions, localConfig, localDays))
      if (localBlocks.length > 0) setBlocks(localBlocks)
      setExerciseConfig(localConfig)
      setTrainingDays(localDays)
      // Same fast path for the weight card, so it opens on the real numbers.
      const localWeights = loadWeightsLocal()
      setWeights(localWeights)
      if (localWeights.length > 0) setWeightsReady(true)
      setMounted(true)
    }

    loadProfile().then((p) => {
      if (cancelled) return
      if (!p) {
        router.replace("/onboarding")
        return
      }
      setProfile(p)
      installGuide.trigger()
      whatsNew.trigger()
      weightOptIn.trigger(p)

      // Weekly prompt: asks only when the newest weigh-in is a week old, and "skip
      // this week" holds for a week; every other day is logged by hand from the + on
      // the weight card. Decided off the local log when there is one, so it opens
      // without waiting on KV. An empty local log (a new device) proves nothing, so
      // that case waits for KV below rather than flashing a sheet it may withdraw.
      const localWeights = loadWeightsLocal()
      setWeights(localWeights)
      if (localWeights.length > 0) setWeightsReady(true)
      const askWeighIn = (entries: WeightEntry[]) => {
        const today = dateKey()
        if (p.weighInDaily && weighInDue(entries, today, loadWeighInSkipLocal())) {
          setCheckIn({ day: today, prompted: true })
        }
      }
      if (localWeights.length > 0) askWeighIn(localWeights)

      if (cachedProfile) {
        // Already mounted from cache — just kick off the background KV sync
      } else {
        // First load (no cache): set state and mount now
        const localSessions = loadSessionsLocal()
        const localBlocks = loadBlocksLocal()
        const localConfig = loadExerciseConfigLocal()
        const localDays = loadTrainingDaysLocal()
        if (localSessions.length > 0) setSessions(backfillMuscles(localSessions, localConfig, localDays))
        if (localBlocks.length > 0) setBlocks(localBlocks)
        setExerciseConfig(localConfig)
        setTrainingDays(localDays)
        setMounted(true)
      }

      loadWeights().then((data) => {
        if (cancelled) return
        setWeights(data)
        setWeightsReady(true)
        if (localWeights.length === 0) askWeighIn(data)
      })

      // Async load from KV
      Promise.all([loadAll(), loadExerciseConfig(), loadTrainingDays()]).then(
        ([{ sessions: data, blocks: loadedBlocks }, config, days]) => {
          if (cancelled) return
          setExerciseConfig(config)
          setTrainingDays(days)

          let finalSessions = backfillMuscles(data, config, days)

          // One-time migration for historical "Push" sessions
          const migrated = migrateSessionTypes(finalSessions)
          if (migrated !== null) finalSessions = migrated

          let finalBlocks = loadedBlocks

          // First-time block setup: seed first block from profile anchor (lift-focused only —
          // Balanced users have no anchor and no blocks)
          if (finalBlocks.length === 0 && isLiftFocused(p)) {
            const confirmed = finalSessions.filter((s) => s.confirmed)
            const seededBlocks: TrainingBlock[] = [{
              id: 1,
              phase: "accumulation",
              status: "active",
              sessionIds: [],
              anchorWeight: roundToPlate(p.anchor ?? 0),
              startDate: null,
              endDate: null,
              length: blockLengthFor("accumulation", measureSessionsPerWeek(confirmed, null)),
            }]
            const upcoming = createUpcomingSession(confirmed, seededBlocks, config, p, days)
            finalSessions = sortSessions([...confirmed, upcoming])
            finalBlocks = seededBlocks
            saveAll(finalSessions, finalBlocks)
            setSessions(finalSessions)
            setBlocks(finalBlocks)
            return
          }

          // Normal load: ensure an upcoming session exists and matches the training mode
          const currentUpcoming = finalSessions.find((s) => !s.confirmed)
          if (!upcomingMatchesMode(currentUpcoming, p)) {
            const confirmed = finalSessions.filter((s) => s.confirmed)
            const upcoming = createUpcomingSession(confirmed, finalBlocks, config, p, days)
            finalSessions = sortSessions([...confirmed, upcoming])
            saveAll(finalSessions, finalBlocks)
          }

          setSessions(finalSessions)
          setBlocks(finalBlocks)
        }
      )
    })

    return () => { cancelled = true }
  // Load once per mount. The hook objects are fresh every render; listing them would re-run the whole load.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  // Keep ref in sync so event listener always sees fresh sessions
  useEffect(() => { sessionsRef.current = sessions }, [sessions])

  // Listen for mini-player resume event (same-page case)
  useEffect(() => {
    function handleResumeEvent(e: Event) {
      const sessionId = (e as CustomEvent<{ sessionId: string }>).detail?.sessionId
      if (!sessionId) return
      sessionStorage.removeItem('lift-tracker-resume')
      const target = sessionsRef.current.find(s => s.id.toString() === sessionId)
      const draft = loadDraft()
      if (target && draft && draft.sessionId.toString() === sessionId) {
        setLoggingSession(JSON.parse(JSON.stringify(target)))
        setActiveDraft(draft)
        scheduleIncompleteSessionReminder()
      }
    }
    window.addEventListener('mini-player-resume', handleResumeEvent)
    return () => window.removeEventListener('mini-player-resume', handleResumeEvent)
  }, [])

  // Resume from sessionStorage once sessions are loaded (cross-page navigation case)
  useEffect(() => {
    if (sessions.length === 0) return
    const resumeId = sessionStorage.getItem('lift-tracker-resume')
    if (!resumeId) return
    sessionStorage.removeItem('lift-tracker-resume')
    const target = sessions.find(s => s.id.toString() === resumeId)
    const draft = loadDraft()
    if (target && draft && draft.sessionId.toString() === resumeId) {
      setLoggingSession(JSON.parse(JSON.stringify(target)))
      setActiveDraft(draft)
      scheduleIncompleteSessionReminder()
    }
  }, [sessions])

  useEffect(() => {
    if (!profile) return

    const fetchPresences = () => {
      fetch("/api/presence")
        .then((r) => r.ok ? r.json() : [])
        .then((data: UserPresence[]) => {
          if (!Array.isArray(data)) return
          const prev = prevPresencesRef.current
          if (presenceInitialisedRef.current) {
            data
              .filter(
                (p) =>
                  p.inSession &&
                  p.email !== profile.email &&
                  friendEmailsRef.current.has(p.email.trim().toLowerCase()) &&
                  !prev.find((q) => q.email === p.email && q.inSession)
              )
              .forEach((p) => {
                const id = `${Date.now()}-${p.email}`
                setToasts((t) => [...t, { id, name: p.name.split(" ")[0] }])
                setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000)
              })
          }
          presenceInitialisedRef.current = true
          prevPresencesRef.current = data
          savePresencesLocal(data)
          setPresences(data)
        })
        .catch(() => {})
    }

    fetchPresences()
    const interval = setInterval(fetchPresences, 15000)
    return () => clearInterval(interval)
  }, [profile])

  useEffect(() => {
    if (!profile) return
    fetch("/api/friends")
      .then((r) => r.ok ? r.json() : [])
      .then((data: (UserProfile & { lastSessionDate?: string | null })[]) => {
        if (!Array.isArray(data)) return
        const emails = new Set(data.map((f) => f.email.trim().toLowerCase()))
        friendEmailsRef.current = emails
        saveFriendEmailsLocal([...emails])
        setFriendEmails(emails)
        setFriendProfiles(data)
        const dates: Record<string, string> = {}
        data.forEach((f) => {
          if (f.lastSessionDate) dates[f.email.trim().toLowerCase()] = f.lastSessionDate
        })
        setFriendLastActive(dates)
        saveFriendLastActiveLocal(dates)
      })
      .catch(() => {})
  }, [profile])

  useEffect(() => {
    if (!profile) return
    function fetchMessages() {
      fetch("/api/messages")
        .then((r) => r.ok ? r.json() : [])
        .then((msgs: GymbroMessage[]) => {
          if (!Array.isArray(msgs)) return
          const grouped = msgs.reduce<Record<string, GymbroMessage[]>>((acc, m) => {
            const key = m.fromEmail.trim().toLowerCase()
            acc[key] = acc[key] ? [...acc[key], m] : [m]
            return acc
          }, {})
          setMessagesByFriend(grouped)
        })
        .catch(() => {})
    }
    fetchMessages()
    const interval = setInterval(fetchMessages, 30000)
    return () => clearInterval(interval)
  }, [profile])

  function subscribeAndStore(vapidKey: string) {
    navigator.serviceWorker.ready
      .then((reg) =>
        reg.pushManager.getSubscription().then((existing) => {
          if (existing) return existing
          const padding = "=".repeat((4 - (vapidKey.length % 4)) % 4)
          const base64 = (vapidKey + padding).replace(/-/g, "+").replace(/_/g, "/")
          const raw = atob(base64)
          const key = Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
          return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
        })
      )
      .then((sub) => {
        // The daily reminder job runs server-side in UTC; the zone rides along with the
        // subscription so it can work out which local day it is asking about.
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
        fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscription: sub.toJSON(), tz }),
        }).catch(() => {})
      })
      .catch(() => {})
  }

  // Register push subscription once profile is loaded.
  // iOS requires Notification.requestPermission() from a user gesture — we
  // can't auto-subscribe there, so we show a banner instead.
  useEffect(() => {
    if (!profile) return
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    if (!vapidKey) return

    if (Notification.permission === "granted") {
      subscribeAndStore(vapidKey)
    } else if (Notification.permission === "default") {
      setShowNotifBanner(true)
    }
  }, [profile])

  async function handleEnableNotifications() {
    setShowNotifBanner(false)
    const permission = await Notification.requestPermission()
    if (permission === "granted") {
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      if (vapidKey) subscribeAndStore(vapidKey)
    }
  }

  function signalPresence(inSession: boolean) {
    // Reflect it locally at once; the polled list would otherwise keep showing the old
    // state (e.g. "lifting now" after confirming) until the next 15s poll.
    if (profile) {
      const me = profile.email.trim().toLowerCase()
      setPresences((prev) =>
        prev.map((p) =>
          p.email.trim().toLowerCase() === me
            ? { ...p, inSession, startedAt: inSession ? new Date().toISOString() : null }
            : p
        )
      )
    }
    fetch("/api/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inSession }),
    }).catch(() => {})
  }

  function handleStartLogging(session: Session) {
    const draft = loadDraft()
    const isLive =
      draft !== null &&
      draft.sessionId === session.id &&
      draft.completedSets.length > 0 &&
      Date.now() - new Date(draft.savedAt).getTime() < DRAFT_MAX_AGE_MS

    clearMiniPlayer()
    signalPresence(true)
    if (isLive) {
      setDraftPrompt({ session: JSON.parse(JSON.stringify(session)), draft })
    } else {
      setLoggingSession(JSON.parse(JSON.stringify(session)))
      scheduleIncompleteSessionReminder()
    }
  }

  function handleEditAnchor() {
    const active = getActiveBlock(blocks)
    setAnchorInput(active ? String(active.anchorWeight) : "")
    setAnchorPrompt(true)
  }

  function handleConfirmAnchor() {
    if (!profile) return
    const parsed = parseFloat(anchorInput)
    if (isNaN(parsed) || parsed <= 0) return
    const anchor = roundToPlate(parsed)
    const confirmed = sessions.filter((s) => s.confirmed)
    const activeBlock = getActiveBlock(blocks)

    let finalBlocks: TrainingBlock[]
    if (activeBlock) {
      finalBlocks = blocks.map((b) =>
        b.id === activeBlock.id ? { ...b, anchorWeight: anchor } : b
      )
    } else {
      finalBlocks = [{
        id: 1,
        phase: "accumulation",
        status: "active",
        sessionIds: [],
        anchorWeight: anchor,
        startDate: null,
        endDate: null,
        length: blockLengthFor("accumulation", measureSessionsPerWeek(confirmed, null)),
      }]
    }

    // Keep the day and extras already picked on the upcoming card; only the loads change.
    const previous = sessions.find((s) => !s.confirmed)
    const regenerated = createUpcomingSession(confirmed, finalBlocks, exerciseConfig, profile, trainingDays)
    const upcoming: Session = previous
      ? {
          ...regenerated,
          selectedTrainingDayId: previous.selectedTrainingDayId,
          selectedMuscleGroups: previous.selectedMuscleGroups,
        }
      : regenerated
    const finalSessions = sortSessions([...confirmed, upcoming])
    saveAll(finalSessions, finalBlocks)
    setSessions(finalSessions)
    setBlocks(finalBlocks)
    setAnchorPrompt(false)
  }

  function handleSaveWeight(day: string, kg: number) {
    const next = upsertEntry(weights, day, kg)
    setWeights(next)
    // Local-first: this cannot fail, so an offline weigh-in still counts. saveWeights
    // also pins profile.bw to the newest reading, both locally and in KV.
    saveWeights(next)
    setCheckIn(null)
    setProfile((p) => {
      const newest = next[next.length - 1]
      return p && newest && p.bw !== newest.kg ? { ...p, bw: newest.kg } : p
    })
  }

  function handleCloseWeighIn() {
    // Only the weekly prompt records a skip; backing out of a manual log changes nothing.
    if (checkIn?.prompted) saveWeighInSkipLocal(dateKey())
    setCheckIn(null)
  }

  function openManualWeighIn() {
    setCheckIn({ day: dateKey(), prompted: false })
  }

  function handleConfirmSession(incoming: Session) {
    if (!profile) return

    // Fill in the bodyweight this session was trained at, from that day's check-in.
    // The field has always existed and is already rendered by SessionCard, the session
    // detail page and the share card — until now nothing ever wrote it. An existing
    // value is left alone, so re-confirming never overwrites.
    const updatedSession: Session =
      incoming.bw != null || !profile.weighInDaily
        ? incoming
        : { ...incoming, bw: bwForSession(weights, incoming.date) }

    const prevBestE1RM = getBestE1RM(sessions.filter((s) => s.confirmed))
    const currentSessions = sessions
    const currentBlocks = blocks

    const updatedSessions = currentSessions.map((s) =>
      s.id === updatedSession.id ? { ...updatedSession, blockId: updatedSession.blockId } : s
    )
    const confirmedSessions = updatedSessions.filter((s) => s.confirmed)

    // Balanced mode never advances a block; whatever blocks exist stay parked for a later
    // switch back. A session that skipped the main lift doesn't advance one either — the
    // block stays where it is so the load it was carrying is prescribed again next time.
    const advancesBlock = isLiftFocused(profile) && !updatedSession.skippedMainLift
    const activeBlock = advancesBlock ? getActiveBlock(currentBlocks) : undefined
    let finalBlocks = currentBlocks

    if (activeBlock) {
      const updatedBlockSessionIds = [...activeBlock.sessionIds, updatedSession.id]
      const isBlockComplete =
        blockPosition({ ...activeBlock, sessionIds: updatedBlockSessionIds }) >= getBlockLength(activeBlock)

      if (isBlockComplete) {
        const completedBlock: TrainingBlock = {
          ...activeBlock,
          sessionIds: updatedBlockSessionIds,
          status: "completed",
          endDate: updatedSession.date ?? null,
        }
        // Re-acclimation finishes by resuming the interrupted block it was rebuilding
        // toward, rather than advancing into a fresh phase.
        finalBlocks = closeBlock(currentBlocks, completedBlock, confirmedSessions)
      } else {
        finalBlocks = currentBlocks.map((b) =>
          b.id === activeBlock.id ? { ...b, sessionIds: updatedBlockSessionIds } : b
        )
      }
    }

    const newUpcoming = createUpcomingSession(confirmedSessions, finalBlocks, exerciseConfig, profile, trainingDays)
    const final = sortSessions([...confirmedSessions, newUpcoming])

    setSessions(final)
    setBlocks(finalBlocks)
    saveAll(final, finalBlocks)
    clearMiniPlayer()
    setLoggingSession(null)
    setActiveDraft(null)

    cancelIncompleteSessionReminder()
    signalPresence(false)
    setLastConfirmed(updatedSession)

    // A new best e1RM is the moment the whole block exists for, so it gets called out.
    const newBestE1RM = getBestE1RM(confirmedSessions)
    const pr =
      prevBestE1RM != null && newBestE1RM != null && newBestE1RM > prevBestE1RM
        ? { e1rm: newBestE1RM, previous: prevBestE1RM }
        : null
    setLastPR(pr)
    // With no gymbros the roast panel has nothing to offer but a skip button, so it only
    // opens to celebrate a PR.
    if (friendProfiles.length > 0 || pr) setShowHypePanel(true)
  }

  /** A skip or restore invalidates any draft still holding the old exercise list. */
  function dropStaleDraft(sessionId: number) {
    const draft = loadDraft()
    if (draft?.sessionId === sessionId) {
      clearDraft()
      clearMiniPlayer()
    }
  }

  /**
   * Train today without the main lift. The session drops to accessories only and stays
   * outside the block, so the load it was going to carry opens the next session instead.
   */
  function handleSkipMainLift(session: Session) {
    const liftShort = getMainLiftShortLabel(profile)
    const held = describePrescription(session)
    const ask = held
      ? `Skip ${liftShort} today? ${held} stays on deck — it opens your next session.`
      : `Skip ${liftShort} today? Its prescribed load moves to your next session.`
    if (!window.confirm(ask)) return

    const skipped: Session = {
      ...session,
      type: "Free",
      sets: [],
      blockId: undefined,
      skippedMainLift: true,
      coachNote: held
        ? `${liftShort} sat out today — ${held} moves to the next session. Everything else, full effort.`
        : `${liftShort} sat out today — its load moves to the next session.`,
    }

    dropStaleDraft(session.id)
    setSessions((prev) => {
      const updated = prev.map((s) => (s.id === session.id ? skipped : s))
      saveAll(updated, blocks)
      return updated
    })
  }

  /** Put the main lift back on the upcoming card, keeping the training day already chosen. */
  function handleRestoreMainLift(session: Session) {
    if (!profile) return
    const confirmedSessions = sessions.filter((s) => s.confirmed)
    const regenerated = createUpcomingSession(confirmedSessions, blocks, exerciseConfig, profile, trainingDays)
    const restored: Session = {
      ...regenerated,
      id: session.id,
      selectedTrainingDayId: session.selectedTrainingDayId,
      selectedMuscleGroups: session.selectedMuscleGroups,
    }

    dropStaleDraft(session.id)
    setSessions((prev) => {
      const updated = prev.map((s) => (s.id === session.id ? restored : s))
      saveAll(updated, blocks)
      return updated
    })
  }

  /**
   * Move the program straight to a later session (e.g. from Volume 2 to Intensity 3),
   * leaving everything in between unlogged. Blocks run past are closed as they stand.
   */
  function handleJumpTo(target: JumpTarget) {
    if (!profile) return
    const previous = sessions.find((s) => !s.confirmed)
    if (!previous) return
    const confirmedSessions = sessions.filter((s) => s.confirmed)
    const jumped = jumpToSession(blocks, confirmedSessions, target, new Date().toISOString())
    if (!jumped) return

    const regenerated = createUpcomingSession(confirmedSessions, jumped, exerciseConfig, profile, trainingDays)
    const label = slotLabel(target.phase, target.index)
    const to = describePrescription(regenerated)
    const fromKg = previous.skippedMainLift ? undefined : previous.sets.find((s) => !s.isWarmup)?.kg
    const toKg = regenerated.sets.find((s) => !s.isWarmup)?.kg
    const jumpKg = fromKg != null && toKg != null ? toKg - fromKg : 0
    const skipped = countSkippedSlots(jumped) - countSkippedSlots(blocks)

    const ask =
      `Jump to ${label}${to ? ` — ${to}` : ""}? ` +
      `${skipped} session${skipped === 1 ? "" : "s"} in between ${skipped === 1 ? "is" : "are"} skipped and won't count as trained.` +
      (jumpKg > 0 ? ` That's +${jumpKg}kg on today's ${fromKg}kg.` : "")
    if (!window.confirm(ask)) return

    // A bigger load than the body has been prepared for: the first working set decides.
    const caution =
      jumpKg > 0
        ? ` Jumped ahead from ${fromKg}kg — if the first working set moves slow, drop 2.5kg for the rest.`
        : ""
    const upcoming: Session = {
      ...regenerated,
      id: previous.id,
      coachNote: regenerated.coachNote + caution,
      selectedTrainingDayId: previous.selectedTrainingDayId,
      selectedMuscleGroups: previous.selectedMuscleGroups,
    }

    dropStaleDraft(previous.id)
    const finalSessions = sortSessions([...confirmedSessions, upcoming])
    setSessions(finalSessions)
    setBlocks(jumped)
    saveAll(finalSessions, jumped)
    setViewingBlockId(null)
    setViewingUpcomingPhase(null)
    setJumpUndo({ before: blocks, after: jumped, upcoming: previous, label })
  }

  /** Put the program back where it stood before the last jump. */
  function handleUndoJump() {
    if (!jumpUndo || jumpUndo.after !== blocks) return
    const current = sessions.find((s) => !s.confirmed)
    const restored: Session = {
      ...jumpUndo.upcoming,
      selectedTrainingDayId: current?.selectedTrainingDayId ?? jumpUndo.upcoming.selectedTrainingDayId,
      selectedMuscleGroups: current?.selectedMuscleGroups ?? jumpUndo.upcoming.selectedMuscleGroups,
    }
    dropStaleDraft(restored.id)
    const finalSessions = sortSessions([...sessions.filter((s) => s.confirmed), restored])
    setSessions(finalSessions)
    setBlocks(jumpUndo.before)
    saveAll(finalSessions, jumpUndo.before)
    setJumpUndo(null)
  }

  function handleAvatarClick(p: UserPresence) {
    const key = p.email.trim().toLowerCase()
    const msgs = messagesByFriend[key] ?? []
    setMsgPopupFriend(p)
    setMsgPopupMessages(msgs)
    setMessagesByFriend((prev) => {
      const updated = { ...prev }
      delete updated[key]
      return updated
    })
    fetch("/api/messages", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromEmail: p.email }),
    }).catch(() => {})
  }

  function handleCloseModal() {
    cancelIncompleteSessionReminder()
    signalPresence(false)
    clearMiniPlayer()
    setLoggingSession(null)
    setActiveDraft(null)
  }

  function handleMinimizeModal() {
    setLoggingSession(null)
    setActiveDraft(null)
    // mini-player state already saved by LogSessionModal before this is called
  }

  function handleEditSession(session: Session) {
    setEditingSession(JSON.parse(JSON.stringify(session)))
  }

  function handleSaveEdit(updatedSession: Session) {
    setSessions((prev) => {
      let updated = prev.map((s) =>
        s.id === updatedSession.id ? updatedSession : s
      )
      // An edited RPE or rep count changes what the cycle has learned, so re-plan the
      // upcoming loads, keeping the day picked and the main lift choice on the card.
      const upcoming = updated.find((s) => !s.confirmed)
      if (profile && isLiftFocused(profile) && upcoming && !upcoming.skippedMainLift) {
        const confirmed = updated.filter((s) => s.confirmed)
        const regenerated = createUpcomingSession(confirmed, blocks, exerciseConfig, profile, trainingDays)
        updated = sortSessions([
          ...confirmed,
          {
            ...regenerated,
            id: upcoming.id,
            selectedTrainingDayId: upcoming.selectedTrainingDayId,
            selectedMuscleGroups: upcoming.selectedMuscleGroups,
            extraWorkouts: upcoming.extraWorkouts,
          },
        ])
      }
      saveAll(updated, blocks)
      return updated
    })
    setEditingSession(null)
  }

  function handleUpdateMuscleGroups(session: Session, groups: MuscleGroup[], dayId?: string) {
    setSessions((prev) => {
      const updated = prev.map((s) =>
        s.id === session.id
          ? { ...s, selectedMuscleGroups: groups, ...(dayId !== undefined ? { selectedTrainingDayId: dayId } : {}) }
          : s
      )
      saveAll(updated, blocks)
      return updated
    })
  }

  function handleUnlogSession(session: Session) {
    if (!profile) return
    if (!window.confirm(`Unlog Session ${String(session.id).padStart(2, "0")}? This will remove it from your history.`)) return

    const remaining = sessions.filter((s) => s.confirmed && s.id !== session.id)

    const sessionBlockId = session.blockId
    // Unlogging the session that just completed a block (nothing logged in any later
    // block yet) rewinds into it: the empty follow-on blocks go and it reopens. Anything
    // older only unlinks the session — later blocks hold real training and must survive.
    const canRewind =
      sessionBlockId !== undefined &&
      blocks.every((b) => b.id <= sessionBlockId || b.sessionIds.length === 0)
    let newBlocks = sessionBlockId === undefined ? blocks : blocks
      .filter((b) => !(canRewind && b.id > sessionBlockId))
      .map((b) => {
        if (b.id !== sessionBlockId) return b
        const sessionIds = b.sessionIds.filter((id) => id !== session.id)
        return canRewind
          ? { ...b, sessionIds, status: "active" as const, endDate: null }
          : { ...b, sessionIds }
      })

    if (sessionBlockId !== undefined && !getActiveBlock(newBlocks) && newBlocks.length > 0) {
      const lastBlock = newBlocks[newBlocks.length - 1]
      newBlocks = newBlocks.map((b) =>
        b.id === lastBlock.id ? { ...b, status: "active" as const } : b
      )
    }

    const newUpcoming = createUpcomingSession(remaining, newBlocks, exerciseConfig, profile, trainingDays)
    const final = sortSessions([...remaining, newUpcoming])

    setSessions(final)
    setBlocks(newBlocks)
    saveAll(final, newBlocks)
  }

  /**
   * Rewind the active block to session 1 after a long layoff. The phase and anchor
   * stay put; the sessions logged before the break stay in history, just unlinked
   * from the block so it re-prescribes from the start.
   */
  function handleRestartBlock() {
    if (!profile) return
    const active = getActiveBlock(blocks)
    if (!active) return
    if (
      !confirm(
        `Restart ${PHASE_LABEL[active.phase]} from session 1 with your anchor eased 5% to ${layoffAnchor(active.anchorWeight)}kg? Your logged sessions stay in history.`
      )
    )
      return

    const { sessions: restartedSessions, blocks: newBlocks } = restartActiveBlock(sessions, blocks)
    const newUpcoming = createUpcomingSession(restartedSessions, newBlocks, exerciseConfig, profile, trainingDays)
    const final = sortSessions([...restartedSessions, newUpcoming])

    setSessions(final)
    setBlocks(newBlocks)
    saveAll(final, newBlocks)
    dismissLayoffBanner()
  }

  function dismissLayoffBanner() {
    const state = getLayoffState(sessions)
    if (!state.lastSessionDate) return
    const key = `${state.lastSessionDate}:${state.tier}`
    saveLayoffDismissLocal(key)
    setLayoffDismissed(key)
  }

  if (!mounted || !profile) {
    return (
      <main className="mx-auto w-full max-w-[393px] px-4 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(4rem+env(safe-area-inset-bottom))]">
        <div className="h-3 w-32 bg-[#e8e8e8] rounded animate-pulse mb-1" />
        <div className="h-8 w-40 bg-[#e8e8e8] rounded animate-pulse mb-6" />
        <div className="h-[2px] w-full bg-[#e8e8e8] rounded mb-6" />
        <div className="grid grid-cols-2 border border-[#e8e8e8] rounded-[10px] overflow-hidden mb-6 h-24" />
      </main>
    )
  }

  const confirmed = sessions.filter((s) => s.confirmed)
  const upcoming = sessions.find((s) => !s.confirmed)
  const recommendedDay = suggestNextDay(sessions, trainingDays, exerciseConfig)
  const confirmedSorted = [...confirmed].sort(
    (a, b) => new Date(b.date!).getTime() - new Date(a.date!).getTime()
  )

  const activeBlock = getActiveBlock(blocks)
  const activeBlockSessionIds = new Set(activeBlock?.sessionIds ?? [])

  const activeBlockSessions = confirmedSorted.filter((s) => activeBlockSessionIds.has(s.id))

  const viewingBlock = viewingBlockId != null
    ? (blocks.find((b) => b.id === viewingBlockId) ?? activeBlock)
    : activeBlock
  const viewingBlockSessionIds = new Set(viewingBlock?.sessionIds ?? [])
  const viewingBlockSessions = confirmedSorted
    .filter((s) => viewingBlockSessionIds.has(s.id))
    .sort((a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime())

  let blockIndexMap = new Map<number, number>()
  if (activeBlock) {
    const chronoConfirmed = [...activeBlockSessions].sort(
      (a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime()
    )
    blockIndexMap = blockSlotNumbers(activeBlock, chronoConfirmed.map((s) => s.id))
    if (upcoming?.blockId === activeBlock.id) {
      blockIndexMap.set(upcoming.id, blockPosition(activeBlock) + 1)
    }
  }
  const viewingBlockIndexMap = viewingBlock
    ? blockSlotNumbers(viewingBlock, viewingBlockSessions.map((s) => s.id))
    : new Map<number, number>()

  // Long enough away that the plan is stale? Nudge at a week, offer a restart at two.
  const layoff = getLayoffState(sessions)
  const showLayoffBanner =
    layoff.tier !== "none" && layoffDismissed !== `${layoff.lastSessionDate}:${layoff.tier}`

  const latestE1RM = getBestE1RM(sessions)
  const bestWeight = getBestWeight(sessions)
  const latestBW = getLatestBW(sessions)

  const liftLabel = getMainLiftLabel(profile)
  const liftShort = getMainLiftShortLabel(profile)
  const liftFocused = isLiftFocused(profile)

  // Sessions logged without the main lift carry no blockId, so block membership can't
  // place them — they'd drop off home the moment they were logged. Show them next to the
  // block's own sessions, and keep the block's untouched prescription visible.
  const stretchSkips = liftFocused ? currentStretchSkips(confirmed, blocks) : []
  const activeStretchSessions = [...activeBlockSessions, ...stretchSkips].sort(
    (a, b) => new Date(b.date!).getTime() - new Date(a.date!).getTime()
  )
  const consecutiveSkips = liftFocused ? countConsecutiveSkips(confirmed) : 0
  const skipNudge =
    consecutiveSkips >= 2
      ? `${liftShort} skipped ${consecutiveSkips} sessions running — it's first up today.`
      : undefined
  // What the cycle has learned so far, applied to every load still to come this cycle.
  const activeOffset = activeBlock ? cycleLoadOffset(blocks, confirmed, activeBlock) : 0
  const upcomingRx = liftFocused && activeBlock
    ? prescribeForBlock(activeBlock, blockPosition(activeBlock), activeOffset)
    : undefined
  const heldPrescription = upcomingRx
    ? `${upcomingRx.weight}kg × ${upcomingRx.reps} × ${upcomingRx.sets}`
    : undefined
  const upcomingTarget = (() => {
    if (!upcomingRx || upcomingRx.rpe == null || upcoming?.skippedMainLift) return undefined
    const isTest = activeBlock?.phase === "realization" && blockPosition(activeBlock) === getBlockLength(activeBlock) - 1
    const effort = isTest
      ? "Max single · log its RPE, it sets your next anchor"
      : `${upcomingRx.light ? "Light day · aim" : "Aim"} for RPE ${upcomingRx.rpe}`
    const adjust =
      activeOffset > 0
        ? ` · +${activeOffset}kg, recent sessions felt easy`
        : activeOffset < 0
        ? ` · ${activeOffset}kg, recent sessions ran hard`
        : ""
    return effort + adjust
  })()
  const firstName = profile.name.split(" ")[0]

  // Anything already covering the screen. The weight sheets queue behind all of it —
  // slamming a weigh-in prompt over a session the user is mid-way through logging
  // would be worse than asking a minute later.
  const overlayOpen =
    loggingSession != null ||
    editingSession != null ||
    draftPrompt != null ||
    anchorPrompt ||
    showHypePanel ||
    shareSession != null ||
    msgPopupFriend != null

  // Dot's tap bubble talks about the next session; while logging, a tap only winks.
  const dotCue =
    loggingSession || editingSession
      ? null
      : buildDotCue(
          upcoming,
          liftFocused ? profile.mainLift : undefined,
          trainingDays.find((d) => d.id === upcoming?.selectedTrainingDayId)?.name
        )
  // Strict priority: install guide → what's new → opt-in → weekly check-in. Each waits
  // on every higher-priority sheet, extending the `!installGuide.show` guard already
  // used for What's New rather than inventing a second mechanism.
  const showWeightOptIn = weightOptIn.show && !installGuide.show && !whatsNew.show && !overlayOpen
  const showCheckIn =
    checkIn != null && !installGuide.show && !whatsNew.show && !weightOptIn.show && !overlayOpen

  return (
    <>
      <NavDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <DotBuddy
        cue={dotCue}
        startAsleep={layoff.lastSessionDate != null && layoff.days >= DOT_ASLEEP_AFTER_DAYS}
      />

      {installGuide.show && (
        <InstallGuideModal onDismiss={installGuide.dismiss} />
      )}

      {/* What's new since the last version this device saw; waits behind the install guide */}
      {whatsNew.show && !installGuide.show && (
        <WhatsNewModal releases={whatsNew.releases} onDismiss={whatsNew.dismiss} />
      )}

      {/* One-time ask for users who predate weight check-ins. New users answer it in onboarding. */}
      {showWeightOptIn && (
        <WeightOptInSheet
          saving={weightOptIn.saving}
          error={weightOptIn.error}
          // Saying yes leads straight into the first weigh-in rather than dropping the
          // user on an empty card — that first entry is what makes everything else work.
          onAccept={() => {
            weightOptIn.answer(profile, true).then((p) => {
              if (p) openManualWeighIn()
            })
          }}
          onDecline={() => weightOptIn.answer(profile, false)}
        />
      )}

      {showCheckIn && checkIn && (
        <WeightCheckInSheet
          entries={weights}
          date={checkIn.day}
          fallbackKg={weights[weights.length - 1]?.kg ?? profile.bw}
          onSave={handleSaveWeight}
          onClose={handleCloseWeighIn}
          skippable={checkIn.prompted}
        />
      )}

      <main className="mx-auto w-full max-w-[393px] px-4 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(4rem+env(safe-area-inset-bottom))]">
        {/* Header */}
        <header className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-[#bbbbbb] lowercase mb-0.5">best workout tracker.</p>
              <h1
                className="text-2xl font-semibold text-[#111111] tracking-tight select-none cursor-pointer"
                onPointerDown={handleTitlePointerDown}
                onPointerUp={handleTitlePointerUp}
                onPointerLeave={handleTitlePointerCancel}
                role="button"
                aria-label="Open profile"
              >
                hello, {firstName}
              </h1>
            </div>
            <button
              onClick={() => setDrawerOpen(true)}
              className="p-1 -mr-1 text-[#555555] hover:text-[#111111] transition-colors shrink-0"
              aria-label="Open menu"
            >
              <svg width="20" height="14" viewBox="0 0 20 14" fill="currentColor" aria-hidden="true">
                <rect y="0" width="20" height="2" rx="1" />
                <rect y="6" width="20" height="2" rx="1" />
                <rect y="12" width="20" height="2" rx="1" />
              </svg>
            </button>
          </div>
        </header>

        {/* Gymbros timeline */}
        <GymbrosTimeline
          friendPresences={presences.filter((p) => friendEmails.has(p.email.trim().toLowerCase()))}
          currentUserEmail={profile.email}
          currentUserName={profile.name}
          currentUserInSession={presences.find((p) => p.email === profile.email)?.inSession ?? false}
          currentUserLastSessionDate={confirmedSorted[0]?.date ?? null}
          friendLastActive={friendLastActive}
          messagesByFriend={messagesByFriend}
          onAvatarClick={handleAvatarClick}
        />

        {/* Notification opt-in banner (needed on iOS PWA where auto-subscribe is blocked) */}
        {showNotifBanner && (
          <div className="flex items-center justify-between gap-3 mb-4 px-3 py-2.5 rounded-xl bg-[#f5f5f5] border border-[#e8e8e8]">
            <span className="text-sm text-[#444444]">Enable notifications for friend requests</span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleEnableNotifications}
                className="text-sm font-medium text-[#111111] bg-white border border-[#d0d0d0] rounded-lg px-3 py-1 active:opacity-70"
              >
                Enable
              </button>
              <button
                onClick={() => setShowNotifBanner(false)}
                className="text-[#999999] active:opacity-70"
                aria-label="Dismiss"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
                  <path d="M1.41 0L0 1.41 5.59 7 0 12.59 1.41 14 7 8.41 12.59 14 14 12.59 8.41 7 14 1.41 12.59 0 7 5.59 1.41 0z" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Layoff warning — time off means the prescribed loads may no longer be real */}
        {liftFocused && showLayoffBanner && layoff.tier !== "none" && (
          <LayoffBanner
            tier={layoff.tier}
            days={layoff.days}
            phaseLabel={PHASE_LABEL[activeBlock?.phase ?? "accumulation"]}
            sessionsIntoBlock={activeBlock?.sessionIds.length ?? 0}
            anchorWeight={activeBlock?.anchorWeight ?? profile.anchor ?? 0}
            onRestart={handleRestartBlock}
            onDismiss={dismissLayoffBanner}
          />
        )}

        {/* Bodyweight trend. Above the mode split so one insertion serves both modes —
            bodyweight is not a lift-focused or Balanced concern, it's just yours. */}
        {profile.weighInDaily && (
          <WeightCard entries={weights} loading={!weightsReady} onLog={openManualWeighIn} />
        )}

        {/* Balanced mode: the next session, how balanced the training is, recent ones */}
        {!liftFocused && (
          <BalancedHome
            confirmedSorted={confirmedSorted}
            upcoming={upcoming}
            exerciseConfig={exerciseConfig}
            trainingDays={trainingDays}
            recommendedDayId={recommendedDay?.day.id}
            recommendedReason={recommendedDay?.reason}
            mainLiftLabel={liftLabel}
            onStartLogging={handleStartLogging}
            onUpdateMuscleGroups={handleUpdateMuscleGroups}
            onEdit={handleEditSession}
            onUnlog={handleUnlogSession}
            onShare={setShareSession}
          />
        )}

        {/* Lift-focused mode: target progress, stats, program timeline and the block view */}
        {liftFocused && (
        <>
        {/* Progress Bar */}
        <ProgressBar current={bestWeight} target={profile.target ?? 0} />

        {/* Stats Grid */}
        <StatsGrid
          e1rm={latestE1RM}
          best={bestWeight}
          sessions={confirmed.length}
          bw={latestBW}
          target={profile.target ?? 0}
        />

        {/* Program timeline */}
        {blocks.length > 0 && (
          <ProgramTimeline
            blocks={blocks}
            selectedBlockId={viewingBlockId}
            onBlockSelect={(b) => {
              setViewingBlockId(b?.id ?? null)
              setViewingUpcomingPhase(null)
            }}
            selectedUpcomingPhase={viewingUpcomingPhase}
            onUpcomingPhaseSelect={(phase) => {
              setViewingUpcomingPhase(phase)
              setViewingBlockId(null)
            }}
          />
        )}

        {/* Block view */}
        <div className="mb-4">
          {viewingBlock && !viewingUpcomingPhase && (
            <BlockHeader
              block={viewingBlock}
              confirmedCount={
                (viewingBlock === activeBlock ? activeBlockSessions.length : viewingBlockSessions.length) +
                (viewingBlock.skippedSlots?.length ?? 0)
              }
              onEditAnchor={viewingBlock === activeBlock ? handleEditAnchor : undefined}
            />
          )}

          {/* Banner when browsing a past block */}
          {viewingBlock !== activeBlock && !viewingUpcomingPhase && (
            <button
              onClick={() => setViewingBlockId(null)}
              className="w-full text-left text-xs text-muted-light bg-[#f5f5f5] rounded-xl px-4 py-2.5 mb-2 flex items-center gap-2 active:opacity-70"
            >
              <span>←</span>
              <span>back to current block</span>
            </button>
          )}

          {/* Upcoming phase preview */}
          {viewingUpcomingPhase && activeBlock && (() => {
            const phaseColor: Record<BlockPhase, { bg: string; bar: string; label: string; meta: string }> = {
              accumulation: { bg: "bg-[#f0f7f0]", bar: "bg-[#2d6a2d]", label: "text-[#2d6a2d]", meta: "text-[#4a8a4a]" },
              transmutation: { bg: "bg-[#f5f0ff]", bar: "bg-[#5a2d8a]", label: "text-[#5a2d8a]", meta: "text-[#7a4daa]" },
              realization: { bg: "bg-[#eff6ff]", bar: "bg-[#1e3a5f]", label: "text-[#1e3a5f]", meta: "text-[#3b5f8a]" },
              deload: { bg: "bg-[#f5f5f5]", bar: "bg-[#888888]", label: "text-[#555555]", meta: "text-[#888888]" },
              reacclimation: { bg: "bg-[#fdf3e7]", bar: "bg-[#b06a1e]", label: "text-[#8a4d14]", meta: "text-[#b06a1e]" },
            }
            const style = phaseColor[viewingUpcomingPhase]
            const total = blockLengthFor(viewingUpcomingPhase, measureSessionsPerWeek(confirmed, null))
            const previewOffset = cycleLoadOffset(blocks, confirmed, {
              id: Number.MAX_SAFE_INTEGER,
              phase: viewingUpcomingPhase,
              anchorWeight: activeBlock.anchorWeight,
            })
            return (
              <>
                <div className={`${style.bg} rounded-xl px-4 py-3 mb-2`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-1.5 h-4 rounded-full ${style.bar}`} />
                      <span className={`text-sm font-semibold ${style.label}`}>
                        {PHASE_SESSION_TYPE[viewingUpcomingPhase]}
                      </span>
                      <span className={`text-xs ${style.meta}`}>· projected</span>
                    </div>
                    <span className={`text-xs font-semibold ${style.label} opacity-60`}>{total} sessions</span>
                  </div>
                  <div className="h-1 rounded-full bg-black/10" />
                </div>
                <button
                  onClick={() => setViewingUpcomingPhase(null)}
                  className="w-full text-left text-xs text-muted-light bg-[#f5f5f5] rounded-xl px-4 py-2.5 mb-2 flex items-center gap-2 active:opacity-70"
                >
                  <span>←</span>
                  <span>back to current block</span>
                </button>
                {Array.from({ length: total }, (_, i) => {
                  const p = prescribeBlockSession(viewingUpcomingPhase, i, activeBlock.anchorWeight, total, previewOffset)
                  return (
                    <PreviewSessionRow
                      key={i}
                      label={`Session ${i + 1}${p.light ? " · light" : ""}`}
                      prescription={`${p.weight}kg × ${p.reps} × ${p.sets}`}
                      onJump={upcoming ? () => handleJumpTo({ phase: viewingUpcomingPhase, index: i }) : undefined}
                    />
                  )
                })}
              </>
            )
          })()}

          {/* Active block: upcoming + confirmed sessions + previews */}
          {viewingBlock === activeBlock && !viewingUpcomingPhase && (
            <>
              {jumpUndo && jumpUndo.after === blocks && (
                <div className="flex items-center justify-between rounded-xl bg-[#eff6ff] px-4 py-2.5 mb-2">
                  <span className="text-xs font-semibold text-[#1e3a5f]">Jumped to {jumpUndo.label}</span>
                  <button
                    onClick={handleUndoJump}
                    className="text-xs font-semibold text-[#1e3a5f] underline active:opacity-70"
                  >
                    Undo
                  </button>
                </div>
              )}
              {upcoming && (
                <SessionCard
                  session={upcoming}
                  blockIndex={blockIndexMap.get(upcoming.id)}
                  onStartLogging={handleStartLogging}
                  onUpdateMuscleGroups={handleUpdateMuscleGroups}
                  onSkipMainLift={handleSkipMainLift}
                  onRestoreMainLift={handleRestoreMainLift}
                  exerciseConfig={exerciseConfig}
                  trainingDays={trainingDays}
                  recommendedDayId={recommendedDay?.day.id}
                  mainLiftShortLabel={liftShort}
                  heldPrescription={heldPrescription}
                  targetLine={upcomingTarget}
                  skipNudge={skipNudge}
                />
              )}
              {activeStretchSessions.map((s) => (
                <SessionCard
                  key={s.id}
                  session={s}
                  blockIndex={blockIndexMap.get(s.id)}
                  onEdit={handleEditSession}
                  onUnlog={handleUnlogSession}
                  onShare={setShareSession}
                  exerciseConfig={exerciseConfig}
                  trainingDays={trainingDays}
                  mainLiftShortLabel={liftShort}
                />
              ))}
              {/* Slots jumped over: no session behind them, but they still count in the block */}
              {activeBlock && (activeBlock.skippedSlots?.length ?? 0) > 0 && (
                <div className="px-4 py-2.5 rounded-xl border border-dashed border-[#e8e8e8] mb-2">
                  <span className="text-xs text-[#aaaaaa]">
                    Skipped · Session {[...activeBlock.skippedSlots!].sort((a, b) => a - b).map((i) => i + 1).join(", ")}
                  </span>
                </div>
              )}
              {/* Previews for sessions not yet generated. Tapping one jumps straight to it. */}
              {activeBlock && (() => {
                const position = blockPosition(activeBlock)
                const shownSessions = position + (upcoming && !upcoming.skippedMainLift ? 1 : 0)
                const remaining = getBlockLength(activeBlock) - shownSessions
                if (remaining > 0) {
                  return Array.from({ length: remaining }, (_, i) => {
                    const idx = shownSessions + i
                    const p = prescribeForBlock(activeBlock, idx, activeOffset)
                    return (
                      <PreviewSessionRow
                        key={idx}
                        faint
                        label={`Session ${idx + 1}${p.light ? " · light" : ""}`}
                        prescription={`${p.weight}kg × ${p.reps} × ${p.sets}`}
                        onJump={upcoming && idx > position ? () => handleJumpTo({ phase: activeBlock.phase, index: idx }) : undefined}
                      />
                    )
                  })
                }
                // Last session of the block: offer the one after it, so today's can be
                // skipped outright even where the block has nothing left to preview.
                const next = upcoming && !upcoming.skippedMainLift ? peekNextBlock(blocks, confirmed) : undefined
                if (!next) return null
                const nextIdx = blockPosition(next)
                const p = prescribeForBlock(next, nextIdx, cycleLoadOffset(blocks, confirmed, next))
                return (
                  <PreviewSessionRow
                    faint
                    label={`Next · ${slotLabel(next.phase, nextIdx)}`}
                    prescription={`${p.weight}kg × ${p.reps} × ${p.sets}`}
                    onJump={() => handleJumpTo({ phase: next.phase, index: nextIdx })}
                  />
                )
              })()}
            </>
          )}

          {/* Past block: only confirmed sessions */}
          {viewingBlock !== activeBlock && !viewingUpcomingPhase && viewingBlockSessions.map((s, i) => (
            <SessionCard
              key={s.id}
              session={s}
              blockIndex={viewingBlockIndexMap.get(s.id) ?? i + 1}
              onEdit={handleEditSession}
              onUnlog={handleUnlogSession}
              onShare={setShareSession}
              exerciseConfig={exerciseConfig}
              trainingDays={trainingDays}
              mainLiftShortLabel={liftShort}
            />
          ))}
        </div>
        </>
        )}
      </main>

      {/* Log Session Modal */}
      {loggingSession && (
        <LogSessionModal
          session={loggingSession}
          onConfirm={handleConfirmSession}
          onClose={handleCloseModal}
          onMinimize={handleMinimizeModal}
          previousSessions={confirmedSorted}
          initialDraft={activeDraft ?? undefined}
          exerciseConfig={exerciseConfig}
          mainLiftLabel={liftLabel}
        />
      )}

      {/* Edit Session Modal */}
      {editingSession && (
        <LogSessionModal
          session={editingSession}
          mode="edit"
          onConfirm={handleSaveEdit}
          onClose={() => setEditingSession(null)}
          previousSessions={confirmedSorted}
          exerciseConfig={exerciseConfig}
          mainLiftLabel={liftLabel}
        />
      )}

      {/* Draft resume prompt */}
      {draftPrompt && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
          <div className="bg-white w-full max-w-[393px] rounded-t-2xl px-6 pt-6 pb-10 max-h-[90dvh] overflow-y-auto">
            <p className="text-base font-semibold text-[#111111] mb-1">Resume session?</p>
            <p className="text-sm text-[#777777] mb-6">
              Draft saved {relativeTime(draftPrompt.draft.savedAt)} · {draftPrompt.draft.completedSets.length} set{draftPrompt.draft.completedSets.length !== 1 ? "s" : ""} done
            </p>
            <button
              onClick={() => {
                setActiveDraft(draftPrompt.draft)
                setLoggingSession(draftPrompt.session)
                setDraftPrompt(null)
                scheduleIncompleteSessionReminder()
              }}
              className="w-full bg-[#1e3a5f] text-white text-sm font-semibold rounded-xl py-3.5 mb-3 hover:bg-[#16304f] active:bg-[#0f2540] transition-colors"
            >
              Continue
            </button>
            <button
              onClick={() => {
                clearDraft()
                setLoggingSession(draftPrompt.session)
                setDraftPrompt(null)
                scheduleIncompleteSessionReminder()
              }}
              className="w-full text-xs text-[#aaaaaa] hover:text-[#555555] active:text-[#333333] transition-colors pt-1"
            >
              Start fresh
            </button>
          </div>
        </div>
      )}

      {/* Anchor weight setup / edit */}
      {anchorPrompt && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
          <div className="bg-white w-full max-w-[393px] rounded-t-2xl px-6 pt-6 pb-10 max-h-[90dvh] overflow-y-auto">
            <p className="text-base font-semibold text-[#111111] mb-1">Set your anchor weight</p>
            <p className="text-sm text-[#777777] mb-6">
              Your anchor is the 1RM this cycle is built around. Every load is a percentage of it, nudged by how your logged RPEs compare with the targets.
            </p>
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-[#aaaaaa] mb-2">
              Current 1RM (kg)
            </label>
            <input
              type="number"
              inputMode="decimal"
              value={anchorInput}
              onChange={(e) => setAnchorInput(e.target.value)}
              className="w-full border border-[#e8e8e8] rounded-xl px-4 py-3 text-xl font-semibold text-[#111111] mb-6 focus:outline-none focus:border-[#1e3a5f]"
              placeholder="100"
            />
            <button
              onClick={handleConfirmAnchor}
              disabled={isNaN(parseFloat(anchorInput)) || parseFloat(anchorInput) <= 0}
              className="w-full bg-[#1e3a5f] text-white text-sm font-semibold rounded-xl py-3.5 hover:bg-[#16304f] active:bg-[#0f2540] transition-colors disabled:opacity-40"
            >
              {getActiveBlock(blocks) ? "Update anchor" : "Start Block 1: Accumulation"}
            </button>
          </div>
        </div>
      )}

      {/* Hype panel after session confirm */}
      {showHypePanel && (
        <HypePanelModal
          friends={friendProfiles}
          pr={lastPR}
          liftLabel={liftShort}
          onClose={() => setShowHypePanel(false)}
          onShareWorkout={
            lastConfirmed
              ? () => {
                  setShowHypePanel(false)
                  setShareSession(lastConfirmed)
                }
              : undefined
          }
        />
      )}

      {/* Shareable workout image */}
      {shareSession && profile && (
        <ShareImageModal
          session={shareSession}
          sessions={sessions}
          blocks={blocks}
          profile={profile}
          exerciseConfig={exerciseConfig}
          trainingDays={trainingDays}
          onClose={() => setShareSession(null)}
        />
      )}

      {/* Friend message popup */}
      {msgPopupFriend && (
        <FriendMessagePopup
          friend={msgPopupFriend}
          messages={msgPopupMessages}
          onClose={() => setMsgPopupFriend(null)}
        />
      )}

      {/* Friend online toasts */}
      {toasts.length > 0 && (
        <div className="fixed top-4 left-0 right-0 z-[60] flex flex-col items-center gap-2 pointer-events-none">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className="flex items-center gap-2 bg-white border border-[#e8e8e8] rounded-full px-4 py-2 shadow-md text-sm text-[#333333]"
            >
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
              {toast.name} started lifting
            </div>
          ))}
        </div>
      )}
    </>
  )
}
