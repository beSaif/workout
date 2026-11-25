// Repo policies that used to live as prose (or as a human correcting an agent), checked
// against the files git tracks. Each failure message says how to fix the root cause.
// The full table of agent rules is docs/agent-rules.md.
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(__dirname, "../..")

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" })
}

const tracked = git("ls-files", "-z").split("\0").filter(Boolean)

describe("lockfiles", () => {
  it("tracks pnpm-lock.yaml and no other package manager's lockfile", () => {
    const foreign = tracked.filter((f) =>
      ["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "bun.lockb", "bun.lock"].includes(path.basename(f)),
    )
    expect(
      foreign,
      `Remove ${foreign.join(", ")} (git rm). Vercel and CI install with pnpm 10 from pnpm-lock.yaml, ` +
        "so another lockfile drifts silently and can switch the installer. Add packages with `pnpm add`.",
    ).toEqual([])
    expect(tracked, "pnpm-lock.yaml must be tracked: Vercel and CI run `pnpm install --frozen-lockfile`.").toContain(
      "pnpm-lock.yaml",
    )
  })
})

describe("Next.js conventions", () => {
  it("has no middleware file (Next 16 renamed it to proxy)", () => {
    const middleware = tracked.filter((f) => /^(src\/)?middleware\.(ts|tsx|js|mjs)$/.test(f))
    expect(
      middleware,
      "Next 16 renamed `middleware` to `proxy`: put the code in src/proxy.ts (export `proxy`, not `middleware`). " +
        "This Next.js differs from your training data; read node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md " +
        "before using a Next API.",
    ).toEqual([])
  })
})

describe("project name", () => {
  // Built from parts so this file does not match itself.
  const OLD_NAME = ["bench", "tracker"].join("[-_ ]?")

  /** Occurrences that must stay, each with the reason. Matched per line. */
  const ALLOWED: { file: string; line: RegExp; reason: string }[] = [
    {
      file: "src/lib/userKeys.ts",
      line: /^export const LEGACY_(SESSIONS|EXERCISES)_KEY = /,
      reason: "KV keys of the original owner's data, read to migrate it; renaming them loses that data",
    },
    {
      file: ".claude/skills/verify-workout/lib/target.mjs",
      line: /^export const PRODUCTION_HOSTS = /,
      reason: "the production deployment's original vercel.app alias, a hostname verify.mjs and the fuzz harness must recognise as production",
    },
    {
      file: "docs/agent-rules.md",
      line: /./,
      reason: "documents this rule",
    },
  ]

  it("does not use the old repo name outside the allowlist", () => {
    let out = ""
    try {
      // -I skips binary files; exit status 1 means no match.
      out = git("grep", "-n", "-I", "-i", "-E", OLD_NAME)
    } catch (e) {
      if ((e as { status?: number }).status !== 1) throw e
    }
    const hits = out
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [file, lineNo, ...rest] = l.split(":")
        return { file, lineNo, text: rest.join(":") }
      })
      .filter((h) => !ALLOWED.some((a) => a.file === h.file && a.line.test(h.text)))
      .map((h) => `${h.file}:${h.lineNo}: ${h.text.trim()}`)
    expect(
      hits,
      "The app is Workout (repo beSaif/workout, https://workout.codesaif.dev); the old repo name is gone. " +
        "Use the current name. If an occurrence is stored data or a hostname that must stay, add it to ALLOWED " +
        "in src/test/repo-policy.test.ts with the reason.",
    ).toEqual([])
  })
})

describe("verify-workout feature map", () => {
  const FEATURES = ".claude/skills/verify-workout/features"

  /** Page routes deliberately left out of the map, each with the reason. */
  const UNMAPPED: Record<string, string> = {
    "/dev": "owner-only developer tools, not a user feature (listed under 'Not mapped' in features/README.md)",
  }

  /** src/app/foo/[id]/page.tsx -> /foo/<id>, the way feature files write a dynamic segment. */
  function routeOf(file: string): string {
    const segments = path
      .dirname(path.relative("src/app", file))
      .split(path.sep)
      .filter((s) => s !== "." && !/^\(.*\)$/.test(s)) // route groups don't appear in the URL
      .map((s) => s.replace(/^\[+\.{0,3}(.+?)\]+$/, "<$1>"))
    return "/" + segments.join("/")
  }

  /**
   * Routes each feature file documents as a user entry point: the backticked paths in its
   * "How to get to it (user POV)" section (see features/README.md, "Feature entry
   * contract"), without any query string.
   */
  function documentedRoutes(): Map<string, string[]> {
    const routes = new Map<string, string[]>()
    for (const file of tracked.filter((f) => f.startsWith(`${FEATURES}/`) && f.endsWith(".md"))) {
      if (path.basename(file) === "README.md") continue
      const text = readFileSync(path.join(ROOT, file), "utf8")
      const section = text.split(/^## /m).find((s) => s.startsWith("How to get to it")) ?? ""
      for (const [, raw] of section.matchAll(/`(\/[^`\s]*)`/g)) {
        const route = raw.replace(/[?(].*$/, "")
        routes.set(route, [...(routes.get(route) ?? []), path.basename(file)])
      }
    }
    return routes
  }

  it("maps every page route to a feature file", () => {
    const pages = tracked.filter((f) => f.startsWith("src/app/") && /\/page\.(tsx|ts|jsx|js|mdx)$/.test(f))
    expect(pages.length).toBeGreaterThan(0)
    const documented = documentedRoutes()
    const missing = pages
      .map(routeOf)
      .filter((route) => !documented.has(route) && !(route in UNMAPPED))
    expect(
      missing,
      `Page routes with no feature in ${FEATURES}/. Add or update the feature file (route in backticks under ` +
        `"How to get to it (user POV)", dynamic segments as <name>) and its journey in the same PR; ` +
        "see features/README.md and /maintain-verification-skill. If a route is deliberately unmapped, " +
        "add it to UNMAPPED in src/test/repo-policy.test.ts with the reason.",
    ).toEqual([])
  })

  it("keeps UNMAPPED to routes that exist", () => {
    const routes = new Set(tracked.filter((f) => /^src\/app\/.*page\.(tsx|ts)$/.test(f)).map(routeOf))
    const stale = Object.keys(UNMAPPED).filter((r) => !routes.has(r))
    expect(stale, "Remove these from UNMAPPED in src/test/repo-policy.test.ts: the page is gone.").toEqual([])
  })
})
