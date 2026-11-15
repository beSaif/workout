"use client"

import { forwardRef } from "react"
import { Session, SessionType } from "@/lib/types"
import { sessionSummary, WorkSummary } from "@/lib/stats"

export interface ShareCardProps {
  session: Session
  /** Best e1RM across working sets: the figure every progress bar in the app measures. */
  bestE1RM: number | null
  bodyweight: number | null
  /** null for Balanced-mode users, who have no goal weight. */
  target: number | null
  date: string | null
  /** null for a Free (Balanced-mode) session, which has no main lift to headline. */
  mainLiftLabel: string | null
  /** What to call this session: the training day for a Free session, the phase otherwise. */
  dayLabel: string
  /** Muscle group names trained, already resolved for display. */
  muscleLabels: string[]
  /** Work actually done, accessories included — the only content a Free session has. */
  work: WorkSummary
  /** True when this session belongs to a re-acclimation (rebuild) block. */
  isRebuild?: boolean
  /** The phase the rebuild resumes into, so the track can show what comes next. */
  resumePhaseType?: SessionType | null
}

// Palette mirrors the app tokens in globals.css. Inline hex only — no Tailwind
// color utilities — so html-to-image never has to serialize Tailwind v4 oklch().
const ACCENT = "#1e3a5f"
const ACCENT_BG = "#eff6ff"
const FG = "#111111"
const MUTED_LIGHT = "#aaaaaa"
const BORDER = "#e8e8e8"
const FONT = '"Inter Variable", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'

const SHARE_PHASES = [
  { label: "Volume",    color: "#2d6a2d" },
  { label: "Intensity", color: "#5a2d8a" },
  { label: "Peak",      color: "#1e3a5f" },
  { label: "Deload",    color: "#888888" },
] as const

const PHASE_INDEX: Record<string, number> = {
  Volume: 0, Intensity: 1, Peak: 2, Deload: 3,
}

const REBUILD_COLOR = "#b06a1e"

type CellState = "completed" | "active" | "upcoming"
interface PhaseCell {
  label: string
  color: string
  state: CellState
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso))
}

const ShareCard = forwardRef<HTMLDivElement, ShareCardProps>(function ShareCard(
  {
    session,
    bestE1RM,
    bodyweight,
    target,
    date,
    mainLiftLabel,
    dayLabel,
    muscleLabels,
    work,
    isRebuild = false,
    resumePhaseType = null,
  },
  ref
) {
  const summary = sessionSummary(session)
  const hasSets = summary.weight != null && summary.reps != null && summary.setCount > 0
  // A Free session has no main lift and no block: it headlines the muscles it trained.
  const isFree = session.type === "Free"
  const muscleLine = muscleLabels.join(" + ")
  const activeIdx = PHASE_INDEX[session.type] ?? 0
  const activePhase = SHARE_PHASES[activeIdx]

  // A rebuild session logs as "Volume", so surface its true phase instead.
  const headerLabel = isRebuild ? "Rebuild" : session.type
  const headerColor = isRebuild ? REBUILD_COLOR : activePhase.color

  // Phase track. For a rebuild, splice a "Rebuild" step (active) in front of the
  // phase it resumes into; everything before that phase is already done.
  const resumeIdx = resumePhaseType != null ? PHASE_INDEX[resumePhaseType] ?? 1 : 1
  const cells: PhaseCell[] = isRebuild
    ? SHARE_PHASES.reduce<PhaseCell[]>((acc, p, i) => {
        if (i === resumeIdx) acc.push({ label: "Rebuild", color: REBUILD_COLOR, state: "active" })
        acc.push({ label: p.label, color: p.color, state: i < resumeIdx ? "completed" : "upcoming" })
        return acc
      }, [])
    : SHARE_PHASES.map((p, i) => ({
        label: p.label,
        color: p.color,
        state: i < activeIdx ? "completed" : i === activeIdx ? "active" : "upcoming",
      }))

  const progressPct =
    bestE1RM != null && target != null && target > 0
      ? Math.min(100, Math.round((bestE1RM / target) * 100))
      : null

  return (
    <div
      ref={ref}
      style={{
        width: 1080,
        backgroundColor: "#ffffff",
        color: FG,
        fontFamily: FONT,
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      {/* Top accent bar */}
      <div style={{ height: 8, backgroundColor: ACCENT }} />

      {/* Body */}
      <div
        style={{
          padding: "52px 64px 56px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 48,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {isFree ? (
              <span
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  letterSpacing: 3,
                  textTransform: "uppercase",
                  color: ACCENT,
                }}
              >
                {dayLabel}
              </span>
            ) : (
              <>
            {mainLiftLabel && (
              <>
                <span
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    letterSpacing: 3,
                    textTransform: "uppercase",
                    color: ACCENT,
                  }}
                >
                  {mainLiftLabel}
                </span>
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    backgroundColor: headerColor,
                    display: "inline-block",
                    flexShrink: 0,
                  }}
                />
              </>
            )}
            <span
              style={{
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: 2,
                textTransform: "uppercase",
                color: headerColor,
              }}
            >
              {headerLabel}
            </span>
              </>
            )}
          </div>
          {date && (
            <span style={{ fontSize: 22, color: MUTED_LIGHT, fontWeight: 400 }}>
              {formatDate(date)}
            </span>
          )}
        </div>

        {/* Hero section */}
        <div style={{ marginBottom: 44 }}>
          {isFree ? (
            <span
              style={{
                fontSize: muscleLine.length > 30 ? 60 : muscleLine.length > 16 ? 78 : 104,
                fontWeight: 800,
                lineHeight: 1.05,
                color: ACCENT,
                letterSpacing: -2,
                display: "block",
              }}
            >
              {muscleLine || "Session logged"}
            </span>
          ) : hasSets ? (
            <div style={{ display: "flex", alignItems: "flex-end", gap: 32 }}>
              <span
                style={{
                  fontSize: 136,
                  fontWeight: 800,
                  lineHeight: 1,
                  color: ACCENT,
                  letterSpacing: -4,
                }}
              >
                {summary.weight}kg
              </span>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  paddingBottom: 14,
                }}
              >
                <span style={{ fontSize: 48, fontWeight: 700, color: "#444444", lineHeight: 1 }}>
                  {summary.reps} reps
                </span>
                <span
                  style={{
                    fontSize: 34,
                    fontWeight: 500,
                    color: MUTED_LIGHT,
                    lineHeight: 1,
                  }}
                >
                  {summary.setCount} sets
                </span>
              </div>
            </div>
          ) : (
            <span
              style={{
                fontSize: 96,
                fontWeight: 800,
                lineHeight: 1,
                color: ACCENT,
              }}
            >
              Session logged
            </span>
          )}
        </div>

        {/* Stats strip */}
        <div
          style={{
            display: "flex",
            borderRadius: 20,
            overflow: "hidden",
            border: `2px solid ${BORDER}`,
            marginBottom: 44,
          }}
        >
          {(isFree
            ? [
                { label: "Exercises", value: String(work.exercises), accent: true },
                { label: "Sets", value: String(work.sets), accent: false },
                {
                  label: "Volume",
                  value: work.volume > 0 ? `${work.volume.toLocaleString("en-GB")}kg` : "—",
                  accent: false,
                },
              ]
            : [
                {
                  label: "Est. 1RM",
                  value: bestE1RM != null ? `${bestE1RM}kg` : "—",
                  accent: true,
                },
                { label: "Goal", value: target != null ? `${target}kg` : "—", accent: false },
                {
                  label: "Bodyweight",
                  value: bodyweight != null ? `${bodyweight}kg` : "—",
                  accent: false,
                },
              ]
          ).map((stat, i, arr) => (
            <div
              key={stat.label}
              style={{
                flex: 1,
                padding: "24px 30px",
                backgroundColor: stat.accent ? ACCENT_BG : "#fafafa",
                borderRight: i < arr.length - 1 ? `2px solid ${BORDER}` : "none",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  letterSpacing: 2,
                  textTransform: "uppercase",
                  color: MUTED_LIGHT,
                }}
              >
                {stat.label}
              </span>
              <span
                style={{
                  fontSize: 52,
                  fontWeight: 700,
                  lineHeight: 1,
                  color: stat.accent ? ACCENT : FG,
                }}
              >
                {stat.value}
              </span>
            </div>
          ))}
        </div>

        {/* Phase track — a Free session belongs to no block, so there is nothing to track */}
        {!isFree && (
        <div style={{ marginBottom: 48 }}>
          <div style={{ display: "flex", gap: 10 }}>
            {cells.map((cell, i) => (
              <div
                key={`${cell.label}-${i}`}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  opacity: cell.state === "upcoming" ? 0.65 : 1,
                }}
              >
                <div
                  style={{
                    height: 6,
                    borderRadius: 4,
                    backgroundColor: cell.state === "upcoming" ? "#999999" : cell.color,
                  }}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {cell.state === "completed" && (
                    <span style={{ fontSize: 18, color: cell.color, lineHeight: 1 }}>✓</span>
                  )}
                  {cell.state === "active" && (
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        backgroundColor: cell.color,
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <span
                    style={{
                      fontSize: 20,
                      fontWeight: cell.state === "active" ? 700 : 500,
                      color: cell.state === "upcoming" ? "#888888" : cell.color,
                      lineHeight: 1,
                    }}
                  >
                    {cell.label}
                  </span>
                  {cell.state === "active" && (
                    <span
                      style={{
                        fontSize: 16,
                        fontWeight: 400,
                        color: cell.color,
                        opacity: 0.55,
                      }}
                    >
                      · now
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
        )}

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 32,
            borderTop: `2px solid ${BORDER}`,
          }}
        >
          {/* Brand */}
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 14,
                backgroundColor: ACCENT,
                color: "#ffffff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 30,
                fontWeight: 800,
              }}
            >
              b
            </div>
            <span
              style={{
                fontSize: 30,
                fontWeight: 600,
                letterSpacing: -0.5,
                color: FG,
              }}
            >
              best workout tracker
            </span>
          </div>

          {/* Progress pill */}
          {progressPct !== null && (
            <div
              style={{
                padding: "10px 22px",
                borderRadius: 100,
                backgroundColor: `${ACCENT}12`,
                display: "flex",
                alignItems: "center",
              }}
            >
              <span
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: ACCENT,
                  letterSpacing: 0.5,
                }}
              >
                {progressPct}% to goal
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
})

export default ShareCard
