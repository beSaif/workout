import Link from "next/link"
import { signIn } from "@/auth"

export default function WelcomePage() {
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-6 bg-surface">
      <div className="w-full max-w-[360px] flex flex-col items-center text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-ink-6 mb-3">
          workout
        </p>
        <h1 className="text-[34px] font-semibold text-ink tracking-tight leading-tight mb-3">
          best workout tracker.
        </h1>
        <p className="text-sm text-ink-5 mb-12 leading-relaxed">
          built around your one main lift. logs the work, plans what&apos;s next, and stays out of the way.
        </p>

        <Link
          href="/onboarding"
          className="w-full flex items-center justify-center border border-line rounded-xl py-3.5 text-sm font-semibold text-ink hover:bg-surface-1 active:bg-surface-2 transition-colors"
        >
          get started
        </Link>

        <form
          action={async () => {
            "use server"
            await signIn("google", { redirectTo: "/" })
          }}
          className="mt-8"
        >
          <button type="submit" className="text-xs text-ink-7 hover:text-ink-6 transition-colors">
            i&apos;ve done this before
          </button>
        </form>
      </div>
    </main>
  )
}
