// Unit tests for scripts/merge-gate.mjs, the required `merge-gate` check
// (.github/workflows/merge-gate.yml). See docs/agent-rules.md.
import { describe, expect, it } from "vitest"
import {
  blobDelNames,
  changedPaths,
  decideGate,
  detectIrreversible,
  envVarsIn,
  HELP,
  isExcludedFromContentScan,
  IRREVERSIBLE_NOTICE,
  LABEL,
  MARKER,
  parseDiff,
  pathReasons,
  renderComment,
} from "../../scripts/merge-gate.mjs"

/** A minimal unified diff for one modified file. */
function diffOf(file: string, added: string[] = [], removed: string[] = []): string {
  return [
    `diff --git a/${file} b/${file}`,
    "index 1111111..2222222 100644",
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${removed.length + 1} +1,${added.length + 1} @@`,
    " unchanged context",
    ...removed.map((l) => `-${l}`),
    ...added.map((l) => `+${l}`),
    "",
  ].join("\n")
}

/** Base branch knows the env vars the app reads today. */
const BASE_ENV = new Set(["NODE_ENV", "CRON_SECRET", "KV_REST_API_URL", "PLANNER_API_KEY"])
const isEnvKnown = (name: string) => BASE_ENV.has(name)

function detect(diff: string, headSource?: (p: string) => string | null): string[] {
  return detectIrreversible({ files: parseDiff(diff), isEnvKnown, headSource })
}

describe("parseDiff", () => {
  it("splits added and removed lines per file and ignores headers and context", () => {
    const files = parseDiff(diffOf("src/a.ts", ["+++ looks like a header"], ["--- also content"]))
    expect(files).toEqual([
      { oldPath: "src/a.ts", newPath: "src/a.ts", added: ["+++ looks like a header"], removed: ["--- also content"] },
    ])
  })

  it("handles added, deleted, renamed, binary and quoted paths", () => {
    const diff = [
      "diff --git a/new.ts b/new.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/new.ts",
      "@@ -0,0 +1 @@",
      "+x",
      "diff --git a/gone.ts b/gone.ts",
      "deleted file mode 100644",
      "--- a/gone.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-y",
      "diff --git a/db/old.sql b/db/migrations/001.sql",
      "similarity index 100%",
      "rename from db/old.sql",
      "rename to db/migrations/001.sql",
      "diff --git a/public/my logo.png b/public/my logo.png",
      "Binary files a/public/my logo.png and b/public/my logo.png differ",
      'diff --git "a/caf\\303\\251.ts" "b/caf\\303\\251.ts"',
      '--- "a/caf\\303\\251.ts"',
      '+++ "b/caf\\303\\251.ts"',
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "",
    ].join("\n")
    const files = parseDiff(diff)
    expect(files.map((f) => [f.oldPath, f.newPath])).toEqual([
      [null, "new.ts"],
      ["gone.ts", null],
      ["db/old.sql", "db/migrations/001.sql"],
      ["public/my logo.png", "public/my logo.png"],
      ["café.ts", "café.ts"],
    ])
    expect(changedPaths(files)).toContain("db/migrations/001.sql")
    expect(changedPaths(files)).toContain("gone.ts")
  })
})

describe("irreversible paths", () => {
  it.each([
    ["vercel.json", /Vercel project config/],
    ["vercel.ts", /Vercel project config/],
    [".vercel/project.json", /\.vercel\//],
    [".env", /env file/],
    [".env.production", /env file/],
    ["apps/api/.env.local", /env file/],
    ["src/lib/migrateSessions.ts", /migration/],
    ["db/Migrations/001.sql", /migration/],
    ["MIGRATE.txt", /migration/],
    ["CNAME", /CNAME/],
    ["dns/records.zone", /dns\//],
  ])("flags %s", (p, reason) => {
    const reasons = pathReasons(p)
    expect(reasons.length).toBeGreaterThan(0)
    expect(reasons.join("\n")).toMatch(reason)
  })

  it.each(["src/app/page.tsx", "src/lib/environment.ts", "docs/DEPLOY.md", "public/cname.svg", "src/dnsHelper.ts"])(
    "does not flag %s",
    (p) => expect(pathReasons(p)).toEqual([]),
  )

  it("flags a renamed-away path and a deleted file through the diff", () => {
    const diff = [
      "diff --git a/vercel.json b/vercel.json",
      "deleted file mode 100644",
      "--- a/vercel.json",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-{}",
      "",
    ].join("\n")
    expect(detect(diff).join("\n")).toMatch(/`vercel\.json`: Vercel project config/)
  })

  it("applies path rules even to excluded paths (docs about migrations)", () => {
    expect(detect(diffOf("docs/migration-guide.md", ["text"])).join("\n")).toMatch(/migration/)
  })

  it("merges paths from another source (files API)", () => {
    expect(detectIrreversible({ files: [], paths: ["CNAME"], isEnvKnown })).toHaveLength(1)
  })
})

describe("content scan exclusions", () => {
  it.each([
    "src/lib/__tests__/stats.test.ts",
    "src/foo.spec.tsx",
    "e2e/smoke.spec.ts",
    "e2e/fixtures.ts",
    "tests/helpers.ts",
    ".claude/skills/verify-workout/verify.mjs",
    "docs/DEPLOY.md",
    "README.md",
    "scripts/merge-gate.mjs",
    "src/test/merge-gate.test.ts",
  ])("excludes %s", (p) => expect(isExcludedFromContentScan(p)).toBe(true))

  it.each(["src/lib/userKeys.ts", "src/app/api/sessions/route.ts", "scripts/redact-playwright-report.py", "next.config.ts"])(
    "scans %s",
    (p) => expect(isExcludedFromContentScan(p)).toBe(false),
  )
})

describe("new env vars", () => {
  it("reads dotted and bracketed process.env access", () => {
    expect(envVarsIn('const a = process.env.FOO_BAR ?? process.env["BAZ"]')).toEqual(["FOO_BAR", "BAZ"])
  })

  it("flags an env var the base branch never references", () => {
    const reasons = detect(diffOf("src/lib/stripe.ts", ["const key = process.env.STRIPE_SECRET_KEY"]))
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toMatch(/process\.env\.STRIPE_SECRET_KEY.*new env var someone must set in Vercel/)
  })

  it("does not flag an env var the base branch already references", () => {
    expect(detect(diffOf("src/app/api/cron/reminders/route.ts", ["const s = process.env.CRON_SECRET"]))).toEqual([])
  })

  it("does not flag a new env var in a test file", () => {
    expect(detect(diffOf("src/lib/__tests__/planner.test.ts", ["process.env.TEST_ONLY_FLAG = '1'"]))).toEqual([])
  })
})

describe("destructive KV/Redis/Blob ops", () => {
  it.each([
    "await kv.del(key)",
    "await redis.unlink(k)",
    "await kv.flushdb()",
    "await kv.flushall()",
    "await kv.hdel(h, f)",
    "await kv.srem(s, m)",
    "await kv.zrem(z, m)",
    "await kv.lrem(l, 0, v)",
    "await kv.ltrim(l, 0, 9)",
    "await kv.getdel(k)",
    "await kv.rename(a, b)",
    "await kv.expire(k, 60)",
    "await kv.persist(k)",
  ])("flags an added `%s`", (line) => {
    const reasons = detect(diffOf("src/lib/store.ts", [line]))
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toMatch(/adds a `\.\w+\(` call \(KV\/Redis\/Blob delete/)
  })

  it("flags a removed destructive call too", () => {
    expect(detect(diffOf("src/lib/store.ts", [], ["await kv.del(key)"]))[0]).toMatch(/removes a `\.del\(` call/)
  })

  it("does not flag `.del(` in a test file", () => {
    expect(detect(diffOf("src/lib/__tests__/store.test.ts", ["await kv.del(key)"]))).toEqual([])
    expect(detect(diffOf("e2e/fixtures.ts", ["fake.del(key)"]))).toEqual([])
  })

  it("does not flag look-alikes (model(), .delete() on a Map, .expires)", () => {
    expect(detect(diffOf("src/lib/x.ts", ["const m = model(x)", "cache.delete(k)", "if (s.expires) {}"]))).toEqual([])
  })

  describe("del from @vercel/blob", () => {
    it("parses plain and aliased imports", () => {
      expect(blobDelNames('import { put, del } from "@vercel/blob"')).toEqual(["del"])
      expect(blobDelNames("import { del as removeBlob, list } from '@vercel/blob'")).toEqual(["removeBlob"])
      expect(blobDelNames('import { del } from "./kv"')).toEqual([])
    })

    it("flags adding the import", () => {
      expect(detect(diffOf("src/lib/blob.ts", ['import { del } from "@vercel/blob"']))[0]).toMatch(
        /import of `del` from `@vercel\/blob`/,
      )
    })

    it("flags a bare call when the head file imports it (aliased)", () => {
      const head = 'import { del as removeBlob } from "@vercel/blob"\nexport const f = () => removeBlob(url)\n'
      const reasons = detect(diffOf("src/lib/blob.ts", ["  await removeBlob(url)"]), () => head)
      expect(reasons).toHaveLength(1)
      expect(reasons[0]).toMatch(/`removeBlob\(` call \(`del` from `@vercel\/blob`/)
    })

    it("does not flag a bare del( defined locally", () => {
      const head = "function del(k: string) { return k }\nexport const x = del('a')\n"
      expect(detect(diffOf("src/lib/local.ts", ["export const x = del('a')"]), () => head)).toEqual([])
    })

    it("fails closed on a bare del( when the head file cannot be read", () => {
      expect(detect(diffOf("src/lib/unknown.ts", ["await del(url)"]), () => null)[0]).toMatch(/could not be read/)
    })
  })
})

describe("domains and DNS", () => {
  it.each([
    'fetch(`https://api.vercel.com/v10/projects/${id}/domains`)',
    'fetch("https://api.cloudflare.com/client/v4/user")',
    "const url = base + `/zones/${zone}/dns_records`",
  ])("flags `%s`", (line) => {
    expect(detect(diffOf("src/lib/infra.ts", [line])).join("\n")).toMatch(/domain\/DNS reference/)
  })

  it("does not flag docs mentioning domains", () => {
    expect(detect(diffOf("docs/DEPLOY.md", ["Add the domain under Settings > /domains on api.vercel.com"]))).toEqual([])
    expect(detect(diffOf("README.md", ["See /zones/ in api.cloudflare.com"]))).toEqual([])
  })
})

describe("clean PRs", () => {
  it("finds nothing in an ordinary UI change", () => {
    const diff =
      diffOf("src/components/Card.tsx", ['<div className="p-4">{title}</div>'], ['<div className="p-2">{title}</div>']) +
      diffOf("src/lib/stats.ts", ["const enabled = process.env.NODE_ENV === 'production'"])
    expect(detect(diff)).toEqual([])
  })

  it("does not scan the gate's own source", () => {
    expect(detect(diffOf("scripts/merge-gate.mjs", ['  "flushall",', "await kv.del(k)", "api.cloudflare.com"]))).toEqual([])
  })
})

describe("decideGate", () => {
  const base = {
    labels: [] as string[],
    headRef: "feature/x",
    headSha: "abc1234def",
    autoMergeEnabled: false,
    verifyState: null as string | null,
    pr: 42,
  }

  it("fails on the needs-saif label, even with forge/verify success, and names the fix", () => {
    const r = decideGate({ ...base, labels: ["bug", LABEL], headRef: "claude/x", verifyState: "success" })
    expect(r.pass).toBe(false)
    expect(r.decision).toContain(LABEL)
    expect(r.reasons[0]).toContain(IRREVERSIBLE_NOTICE)
    expect(r.reasons[0]).toMatch(/Fix: Saif reviews the change and removes the `needs-saif` label/)
  })

  it("fails when this run flagged the PR even if the label could not be added", () => {
    const r = decideGate({ ...base, flaggedNow: ["`vercel.json`: Vercel project config"] })
    expect(r.pass).toBe(false)
    expect(r.reasons).toContain("`vercel.json`: Vercel project config")
  })

  it.each([
    ["claude/ branch", { headRef: "claude/merge-gate" }],
    ["auto-merge enabled", { autoMergeEnabled: true }],
  ])("%s: passes with forge/verify success on the head", (_, extra) => {
    const r = decideGate({ ...base, ...extra, verifyState: "success" })
    expect(r).toMatchObject({ pass: true, decision: "pass" })
    expect(r.reasons[0]).toContain("abc1234def")
  })

  it.each([
    [null, "missing"],
    ["pending", "`pending`"],
    ["failure", "`failure`"],
    ["error", "`error`"],
  ])("claude/ branch with forge/verify %s fails and says how Forge produces it", (state, shown) => {
    const r = decideGate({ ...base, headRef: "claude/x", verifyState: state })
    expect(r.pass).toBe(false)
    expect(r.reasons[0]).toContain(`Commit status \`forge/verify\` is ${shown} on the current head abc1234def`)
    expect(r.reasons[1]).toContain("~/.hermes/profiles/forge/scripts/forge_merge_if_green.sh workout 42")
    expect(r.reasons[1]).toMatch(/^Fix: on Forge's host run/)
  })

  it("auto-merge on a human branch also needs forge/verify", () => {
    const r = decideGate({ ...base, autoMergeEnabled: true, verifyState: "pending" })
    expect(r.pass).toBe(false)
    expect(r.reasons[0]).toContain("auto-merge is enabled")
  })

  it("passes a human PR without auto-merge or label, no evidence needed", () => {
    expect(decideGate(base)).toMatchObject({ pass: true, decision: "pass" })
  })
})

describe("rendering and CLI", () => {
  it("comment carries the marker, the notice and every reason", () => {
    const body = renderComment(["reason one", "reason two"], "abcdef1234567")
    expect(body.startsWith(MARKER)).toBe(true)
    expect(body).toContain(IRREVERSIBLE_NOTICE)
    expect(body).toContain("Found in abcdef1:")
    expect(body).toContain("- reason one\n- reason two")
  })

  it("--help documents both commands", () => {
    expect(HELP).toMatch(/node scripts\/merge-gate\.mjs run +--repo/)
    expect(HELP).toMatch(/node scripts\/merge-gate\.mjs detect --diff/)
  })
})
