"use client"

export type ProfileTab = "stats" | "routine"

const TABS: { id: ProfileTab; label: string }[] = [
  { id: "stats", label: "Stats" },
  { id: "routine", label: "Routine" },
]

/**
 * The profile's two views: their stats, and the split they train. Sticks to the top
 * on scroll so a long routine never strands you away from the other tab.
 *
 * It sticks just below the notch rather than padding itself down to it: padding
 * would also push the bar that far from the header while it sits in place. A fixed
 * white band fills the notch instead, so scrolled content never shows above the bar.
 */
export default function ProfileTabs({
  tab,
  onChange,
}: {
  tab: ProfileTab
  onChange: (tab: ProfileTab) => void
}) {
  return (
    <>
      <div className="fixed top-0 inset-x-0 z-20 h-[env(safe-area-inset-top)] bg-surface" aria-hidden="true" />
      <div className="sticky top-[env(safe-area-inset-top)] z-20 -mx-5 px-5 pb-3 mb-1 bg-surface">
        <div role="tablist" className="flex gap-1 p-1 rounded-xl bg-surface-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => onChange(t.id)}
              className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors ${
                tab === t.id ? "bg-surface-pop text-ink shadow-sm" : "text-ink-5 hover:text-ink-2"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
