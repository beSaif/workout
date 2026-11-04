import { MainLift } from "./types"
import { RarityTier } from "./friendCard"

/**
 * The card's look-up tables. Colour lives here rather than in the page so the
 * sprite, the rarity pill and the progress bar can't drift apart.
 */

export interface RarityStyle {
  label: string
  /** Tint behind the sprite. */
  bg: string
  /** Progress fill, and the colour the sprite itself is drawn in. */
  bar: string
  /** Type colour on the rarity pill. */
  ink: string
  /** Only the top tier gets the foil sheen, and only inside the sprite tile. */
  holo: boolean
}

/**
 * Shaped like the old phase-header styles — a tint, a bar and an ink — so a tier
 * reads as a category of the same kind a training phase does. The card frame
 * itself stays the app's plain white surface; rarity is an accent, not a frame.
 */
export const RARITY: Record<RarityTier, RarityStyle> = {
  common: {
    label: "Common",
    bg: "#f5f5f5",
    bar: "#888888",
    ink: "#555555",
    holo: false,
  },
  uncommon: {
    label: "Uncommon",
    bg: "#f0f7f0",
    bar: "#2d6a2d",
    ink: "#2d6a2d",
    holo: false,
  },
  rare: {
    label: "Rare",
    bg: "#fdf3e7",
    bar: "#b06a1e",
    ink: "#8a4d14",
    holo: false,
  },
  holo: {
    label: "Holo rare",
    bg: "#f5f0ff",
    bar: "#5a2d8a",
    ink: "#5a2d8a",
    holo: true,
  },
}

/**
 * The main-lift pill. Same tints the gymbros list badges with, so the row you
 * tapped and the card it opens agree on what a bench gymbro looks like.
 */
export const LIFT_PILL: Record<MainLift, string> = {
  bench: "bg-[#eff6ff] text-[#1e3a5f]",
  squat: "bg-[#f0f5ff] text-[#1e3a7a]",
  deadlift: "bg-[#f2fdf0] text-[#1e5c1a]",
}

/** A Balanced gymbro trains no single lift, so their pill is neutral. */
export const BALANCED_PILL = "bg-[#f5f5f5] text-[#555555]"
