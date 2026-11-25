#!/usr/bin/env node
// merge-gate: the required GitHub check that decides whether a pull request may merge.
//
//  1. Irreversible-change detection (on opened / synchronize / reopened, i.e. when the code
//     changes): Vercel config, env files, migrations, DNS, new env vars, KV/Redis/Blob deletes
//     and domain/DNS API calls. A hit adds the `needs-saif` label and one PR comment.
//  2. Gate (every event), from LIVE API state: fail while `needs-saif` is on the PR; agent PRs
//     (`claude/*` head branch, or auto-merge enabled) need a `forge/verify` success status on
//     the current head SHA.
//
// Plain Node ESM, no dependencies: the workflow runs it without installing the app. The pure
// functions are exported for src/test/merge-gate.test.ts. Every failure names the root-cause
// fix (docs/agent-rules.md). Run `node scripts/merge-gate.mjs --help` for the CLI.

import { execFileSync } from "node:child_process"
import { appendFileSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const LABEL = "needs-saif"
export const MARKER = "<!-- merge-gate -->"
export const VERIFY_CONTEXT = "forge/verify"
export const FORGE_COMMAND = "~/.hermes/profiles/forge/scripts/forge_merge_if_green.sh workout <pr>"
export const IRREVERSIBLE_NOTICE =
  "Irreversible change: this PR never auto-merges. Saif reviews it; removing the `needs-saif` label approves this revision (a new push re-runs the check)."
/** Events on which the code changed, so detection runs. */
export const DETECT_ACTIONS = ["opened", "synchronize", "reopened"]

/**
 * @typedef {{ oldPath: string | null, newPath: string | null, added: string[], removed: string[] }} FileDiff
 * `oldPath` is null for an added file, `newPath` null for a deleted one.
 */

// ---------------------------------------------------------------------------------------------
// Diff parsing
// ---------------------------------------------------------------------------------------------

/** Undo git's C-style quoting of a path ("a/caf\303\251" -> a/café). */
function unquote(p) {
  if (!p.startsWith('"')) return p
  const bytes = []
  const s = p.slice(1, -1)
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "\\") {
      bytes.push(...Buffer.from(s[i]))
      continue
    }
    const n = s[++i]
    if (/[0-7]/.test(n)) {
      bytes.push(parseInt(s.slice(i, i + 3), 8))
      i += 2
    } else {
      bytes.push(({ n: 10, t: 9, r: 13, b: 8, f: 12, v: 11, a: 7 })[n] ?? n.charCodeAt(0))
    }
  }
  return Buffer.from(bytes).toString("utf8")
}

/** "a/foo" -> "foo"; "/dev/null" -> null. */
function stripPrefix(p) {
  const s = unquote(p.trim())
  if (s === "/dev/null") return null
  return s.replace(/^[ab]\//, "")
}

/**
 * Parse a unified git diff (`gh pr diff`) into per-file added and removed lines.
 * @param {string} diff
 * @returns {FileDiff[]}
 */
export function parseDiff(diff) {
  /** @type {FileDiff[]} */
  const files = []
  /** @type {FileDiff | null} */
  let cur = null
  let inHunk = false
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      inHunk = false
      cur = { oldPath: null, newPath: null, added: [], removed: [] }
      files.push(cur)
      // Fallback for binary or mode-only changes, which have no ---/+++ lines.
      const rest = line.slice("diff --git ".length)
      const quoted = rest.match(/^("(?:[^"\\]|\\.)*"|\S+) ("(?:[^"\\]|\\.)*"|\S+)$/)
      if (rest.startsWith('"') && quoted) {
        cur.oldPath = stripPrefix(quoted[1])
        cur.newPath = stripPrefix(quoted[2])
      } else {
        // "a/<p> b/<p>": both halves are the same path unless the file was renamed, in which
        // case "rename from/to" below overrides this.
        const len = (rest.length - 5) / 2
        const p = Number.isInteger(len) ? rest.slice(2, 2 + len) : rest.slice(2)
        cur.oldPath = p
        cur.newPath = p
      }
      continue
    }
    if (!cur) continue
    if (!inHunk) {
      if (line.startsWith("@@")) inHunk = true
      else if (line.startsWith("--- ")) cur.oldPath = stripPrefix(line.slice(4))
      else if (line.startsWith("+++ ")) cur.newPath = stripPrefix(line.slice(4))
      else if (line.startsWith("rename from ") || line.startsWith("copy from "))
        cur.oldPath = unquote(line.replace(/^(rename|copy) from /, ""))
      else if (line.startsWith("rename to ") || line.startsWith("copy to "))
        cur.newPath = unquote(line.replace(/^(rename|copy) to /, ""))
      else if (line.startsWith("new file mode")) cur.oldPath = null
      else if (line.startsWith("deleted file mode")) cur.newPath = null
      continue
    }
    if (line.startsWith("@@")) continue
    if (line.startsWith("+")) cur.added.push(line.slice(1))
    else if (line.startsWith("-")) cur.removed.push(line.slice(1))
  }
  return files
}

/**
 * Every path a diff touches: old and new names of renamed files, deleted files included.
 * @param {FileDiff[]} files
 * @returns {string[]}
 */
export function changedPaths(files) {
  const out = new Set()
  for (const f of files) {
    if (f.oldPath) out.add(f.oldPath)
    if (f.newPath) out.add(f.newPath)
  }
  return [...out]
}

// ---------------------------------------------------------------------------------------------
// Detection rules
// ---------------------------------------------------------------------------------------------

/**
 * Reasons a changed path alone makes a PR irreversible (deploy config, secrets, data
 * migrations, DNS). Empty if none.
 * @param {string} p
 * @returns {string[]}
 */
export function pathReasons(p) {
  const base = path.posix.basename(p)
  const segments = p.split("/")
  const reasons = []
  if (base === "vercel.json" || base === "vercel.ts")
    reasons.push(`\`${p}\`: Vercel project config (routing, crons, headers, build) changes what production runs.`)
  if (segments.slice(0, -1).includes(".vercel"))
    reasons.push(`\`${p}\`: under \`.vercel/\` (project link / deployment settings).`)
  if (base === ".env" || base.startsWith(".env."))
    reasons.push(`\`${p}\`: env file; matching values must be set in Vercel by hand.`)
  if (/migrat(e|ion)/i.test(p)) reasons.push(`\`${p}\`: path mentions a migration; data migrations cannot be undone.`)
  if (base === "CNAME") reasons.push(`\`${p}\`: CNAME file (custom domain).`)
  if (segments.slice(0, -1).includes("dns")) reasons.push(`\`${p}\`: under \`dns/\` (DNS records).`)
  return reasons
}

/**
 * Paths whose added/removed lines are not scanned for env vars, deletes or domain calls:
 * tests, docs, agent skills, and this gate with its test (they quote every pattern).
 * Path rules still apply to them.
 * @param {string} p
 */
export function isExcludedFromContentScan(p) {
  const base = path.posix.basename(p)
  return (
    /\.(test|spec)\./.test(base) ||
    base.endsWith(".md") ||
    /^(e2e|tests|\.claude|docs)\//.test(p) ||
    p === "scripts/merge-gate.mjs" ||
    p === "src/test/merge-gate.test.ts"
  )
}

/**
 * Env var names a line reads via `process.env.NAME` or `process.env["NAME"]`.
 * @param {string} line
 * @returns {string[]}
 */
export function envVarsIn(line) {
  const names = []
  for (const m of line.matchAll(/process\.env(?:\.([A-Za-z_$][\w$]*)|\[\s*["'`]([A-Za-z_$][\w$]*)["'`]\s*\])/g))
    names.push(m[1] ?? m[2])
  return names
}

/** KV/Redis/Blob calls that delete data or change its lifetime. */
export const DESTRUCTIVE_METHODS = [
  "del",
  "unlink",
  "flushdb",
  "flushall",
  "hdel",
  "srem",
  "zrem",
  "lrem",
  "ltrim",
  "getdel",
  "rename",
  "expire",
  "persist",
]
const DESTRUCTIVE_RE = new RegExp(`\\.(${DESTRUCTIVE_METHODS.join("|")})\\(`)

/** Domain / DNS API markers. */
export const DOMAIN_MARKERS = ["/domains", "api.vercel.com", "api.cloudflare.com", "/zones/"]

/**
 * Local names under which a source file imports `del` from `@vercel/blob`
 * (`import { del }`, `import { del as remove }`).
 * @param {string} source
 * @returns {string[]}
 */
export function blobDelNames(source) {
  const names = []
  for (const m of source.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']@vercel\/blob["']/g)) {
    for (const spec of m[1].split(",")) {
      const s = spec.trim().match(/^del(?:\s+as\s+([A-Za-z_$][\w$]*))?$/)
      if (s) names.push(s[1] ?? "del")
    }
  }
  return names
}

function excerpt(line) {
  const t = line.trim()
  return t.length > 120 ? `${t.slice(0, 117)}...` : t
}

/**
 * Irreversible-change reasons for a PR diff. Empty means nothing irreversible was found.
 *
 * @param {object} input
 * @param {FileDiff[]} input.files Parsed diff (parseDiff).
 * @param {string[]} [input.paths] Changed paths from another source (e.g. the files API); merged with the diff's.
 * @param {(name: string) => boolean} input.isEnvKnown True if the env var name is referenced anywhere in the base branch tree.
 * @param {(path: string) => string | null} [input.headSource] The file's content at the PR head (null if unavailable), used to resolve `del` imported from `@vercel/blob`.
 * @returns {string[]}
 */
export function detectIrreversible({ files, paths = [], isEnvKnown, headSource = () => null }) {
  const reasons = []
  const seen = new Set()
  const add = (r) => {
    if (!seen.has(r)) {
      seen.add(r)
      reasons.push(r)
    }
  }

  for (const p of [...new Set([...changedPaths(files), ...paths])].sort()) for (const r of pathReasons(p)) add(r)

  for (const f of files) {
    const p = /** @type {string} */ (f.newPath ?? f.oldPath)
    if ((f.newPath && isExcludedFromContentScan(f.newPath)) || (!f.newPath && isExcludedFromContentScan(p))) continue

    // `del` from @vercel/blob: names imported in the head file, or in the changed lines themselves.
    let blobNames = null
    const resolveBlobNames = () => {
      if (blobNames) return blobNames
      const src = headSource(p)
      blobNames = { names: blobDelNames([src ?? "", ...f.added, ...f.removed].join("\n")), known: src !== null }
      return blobNames
    }

    for (const [verb, lines] of /** @type {const} */ ([
      ["adds", f.added],
      ["removes", f.removed],
    ])) {
      for (const line of lines) {
        for (const name of envVarsIn(line)) {
          if (!isEnvKnown(name))
            add(
              `\`${p}\`: ${verb} \`process.env.${name}\`, which nothing on the base branch references: a new env var someone must set in Vercel. (\`${excerpt(line)}\`)`,
            )
        }
        const d = line.match(DESTRUCTIVE_RE)
        if (d) add(`\`${p}\`: ${verb} a \`.${d[1]}(\` call (KV/Redis/Blob delete or destructive op). (\`${excerpt(line)}\`)`)

        if (/@vercel\/blob/.test(line) && blobDelNames(line).length)
          add(`\`${p}\`: ${verb} an import of \`del\` from \`@vercel/blob\` (deletes blobs). (\`${excerpt(line)}\`)`)
        else if (/(^|[^\w.$])[A-Za-z_$][\w$]*\s*\(/.test(line)) {
          const { names, known } = resolveBlobNames()
          for (const n of names) {
            if (new RegExp(`(^|[^\\w.$])${n.replace(/\$/g, "\\$")}\\s*\\(`).test(line))
              add(`\`${p}\`: ${verb} a \`${n}(\` call (\`del\` from \`@vercel/blob\`, deletes blobs). (\`${excerpt(line)}\`)`)
          }
          // Fail closed: a bare del( in a file whose head content could not be read.
          if (!known && !names.length && /(^|[^\w.$])del\s*\(/.test(line))
            add(
              `\`${p}\`: ${verb} a bare \`del(\` call and the file could not be read to rule out \`del\` from \`@vercel/blob\`. (\`${excerpt(line)}\`)`,
            )
        }

        const marker = DOMAIN_MARKERS.find((m) => line.includes(m))
        if (marker) add(`\`${p}\`: ${verb} a domain/DNS reference \`${marker}\`. (\`${excerpt(line)}\`)`)
      }
    }
  }
  return reasons
}

// ---------------------------------------------------------------------------------------------
// Gate decision
// ---------------------------------------------------------------------------------------------

/**
 * @typedef {object} GateInput
 * @property {string[]} labels Live labels on the PR.
 * @property {string} headRef Head branch name.
 * @property {string} headSha Current head SHA.
 * @property {boolean} autoMergeEnabled GraphQL pullRequest.autoMergeRequest is set.
 * @property {string | null} verifyState State of the `forge/verify` commit status on headSha (null if missing).
 * @property {number | string} pr PR number, for the Forge command.
 * @property {string[]} [flaggedNow] Irreversible reasons found in this run (fails even if labelling failed).
 */

/**
 * @param {GateInput} input
 * @returns {{ pass: boolean, decision: string, reasons: string[] }}
 */
export function decideGate({ labels, headRef, headSha, autoMergeEnabled, verifyState, pr, flaggedNow = [] }) {
  if (labels.includes(LABEL) || flaggedNow.length) {
    return {
      pass: false,
      decision: `fail: \`${LABEL}\``,
      reasons: [
        `${IRREVERSIBLE_NOTICE} Fix: Saif reviews the change and removes the \`${LABEL}\` label, which re-runs this check; agents never remove it. If the label is wrong, fix the detection in scripts/merge-gate.mjs (with a test) rather than removing it.`,
        ...flaggedNow,
      ],
    }
  }

  const why = []
  if (headRef.startsWith("claude/")) why.push(`head branch \`${headRef}\` is an agent branch (\`claude/*\`)`)
  if (autoMergeEnabled) why.push("auto-merge is enabled")
  if (!why.length) {
    return {
      pass: true,
      decision: "pass",
      reasons: [
        `Not an agent PR (head branch \`${headRef}\` is not \`claude/*\` and auto-merge is off), so no \`${VERIFY_CONTEXT}\` evidence is required. No \`${LABEL}\` label.`,
      ],
    }
  }

  if (verifyState === "success") {
    return {
      pass: true,
      decision: "pass",
      reasons: [`\`${VERIFY_CONTEXT}\` is \`success\` on head ${headSha} (required because ${why.join(" and ")}).`],
    }
  }

  const state = verifyState ?? "missing"
  return {
    pass: false,
    decision: `fail: \`${VERIFY_CONTEXT}\` ${state}`,
    reasons: [
      `Commit status \`${VERIFY_CONTEXT}\` is ${state === "missing" ? "missing" : `\`${state}\``} on the current head ${headSha}; it must be \`success\` because ${why.join(" and ")}.`,
      `Fix: on Forge's host run \`${FORGE_COMMAND.replace("<pr>", String(pr))}\`. After \`ci\` and \`smoke\` pass it runs the verify-workout skill against this PR's Vercel preview, posts \`${VERIFY_CONTEXT}\` = success on the head SHA and enables auto-merge, which re-runs this check. Every new push needs a new verify run; never post the status by hand without a passing verify run.`,
    ],
  }
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------

/**
 * @param {string[]} reasons
 * @param {string} headSha
 */
export function renderComment(reasons, headSha) {
  return [
    MARKER,
    `### merge-gate: \`${LABEL}\``,
    "",
    IRREVERSIBLE_NOTICE,
    "",
    `Found in ${headSha.slice(0, 7)}:`,
    "",
    ...reasons.map((r) => `- ${r}`),
    "",
  ].join("\n")
}

/**
 * @param {{ pass: boolean, decision: string, reasons: string[] }} result
 * @param {{ pr: number | string, headSha: string, action: string, detection: string }} ctx
 */
export function renderSummary(result, ctx) {
  return [
    `## merge-gate: ${result.pass ? "✅" : "❌"} ${result.decision}`,
    "",
    `PR #${ctx.pr}, head ${ctx.headSha}, event \`${ctx.action}\`. Detection: ${ctx.detection}.`,
    "",
    ...result.reasons.map((r) => `- ${r}`),
    "",
  ].join("\n")
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

export const HELP = `Usage:
  node scripts/merge-gate.mjs run    --repo <owner/name> --pr <number> --action <event action>
  node scripts/merge-gate.mjs detect --diff <file> [--base-dir <dir>]
  node scripts/merge-gate.mjs --help

run      What .github/workflows/merge-gate.yml calls. Needs GH_TOKEN (or GITHUB_TOKEN) for gh.
         On --action opened|synchronize|reopened it scans the PR diff for irreversible changes;
         a hit adds the \`${LABEL}\` label and creates or updates one PR comment (marker
         ${MARKER}). Then, on every action, it reads the PR's live labels, head branch,
         head SHA, auto-merge state and the \`${VERIFY_CONTEXT}\` commit status, and exits 1 if:
           - the PR has the \`${LABEL}\` label (or this run flagged it), or
           - the head branch is claude/* or auto-merge is enabled, and \`${VERIFY_CONTEXT}\`
             is not success on the current head SHA.
         Writes the decision to $GITHUB_STEP_SUMMARY when set.
         Env vars new to the PR are checked with \`git grep\` in --base-dir (default: the
         current directory), which must be a checkout of the base branch.

detect   Local dry run of the detection on a saved diff (e.g. \`gh pr diff 123 > pr.diff\` or
         \`git diff main... > pr.diff\`), run from a checkout of the PR head (head files are
         read from the current directory); prints the reasons and exits 1 if any. No API calls.
         Point --base-dir at a checkout of the base branch (e.g. a \`git worktree\` of main),
         or new env vars count as known.

Options:
  --repo       owner/name (default: $GITHUB_REPOSITORY)
  --pr         pull request number
  --action     pull_request event action (default: synchronize)
  --base-dir   checkout of the base branch, for the env var check (default: .)
  --diff       diff file for \`detect\`
  -h, --help   this text
`

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "-h" || a === "--help") args.help = true
    else if (a.startsWith("--")) args[a.slice(2)] = argv[++i]
    else args._.push(a)
  }
  return args
}

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], ...opts })
}

const gh = (...args) => sh("gh", args)

/** True if `name` appears as a whole word in any file tracked in `dir`. */
function envKnownIn(dir) {
  const cache = new Map()
  return (name) => {
    if (!cache.has(name)) {
      let known
      try {
        sh("git", ["grep", "-q", "-w", "-F", "-e", name], { cwd: dir })
        known = true
      } catch (e) {
        if (e.status !== 1) throw new Error(`git grep failed in ${dir}: ${e.stderr || e.message}`)
        known = false
      }
      cache.set(name, known)
    }
    return cache.get(name)
  }
}

function detectionFor(repo, pr, headSha, baseDir) {
  let diff
  try {
    diff = gh("pr", "diff", String(pr), "--repo", repo)
  } catch (e) {
    return [
      `Could not fetch the PR diff to scan it (${String(e.stderr || e.message).trim().split("\n")[0]}). Unscanned changes are treated as irreversible; split the PR if GitHub refuses the diff as too large.`,
    ]
  }
  let paths = []
  try {
    paths = gh("api", "--paginate", `repos/${repo}/pulls/${pr}/files`, "--jq", ".[] | .filename, (.previous_filename // empty)")
      .split("\n")
      .filter(Boolean)
  } catch {
    // The diff headers already list every path; this is a cross-check only.
  }
  // Head file contents (to resolve `del` imported from @vercel/blob): one shallow fetch of the
  // PR head, with the contents API as a per-file fallback.
  let headRef = null
  try {
    sh("git", ["fetch", "--no-tags", "--depth=1", "origin", `+refs/pull/${pr}/head:refs/merge-gate/head`], { cwd: baseDir })
    headRef = "refs/merge-gate/head"
  } catch {
    // fall back below
  }
  const headSource = (p) => {
    try {
      if (headRef) return sh("git", ["show", `${headRef}:${p}`], { cwd: baseDir })
      return gh("api", "-H", "Accept: application/vnd.github.raw", `repos/${repo}/contents/${encodeURI(p)}?ref=${headSha}`)
    } catch {
      return null
    }
  }
  return detectIrreversible({ files: parseDiff(diff), paths, isEnvKnown: envKnownIn(baseDir), headSource })
}

function flagPr(repo, pr, reasons, headSha, labels) {
  if (!labels.includes(LABEL)) gh("api", "-X", "POST", `repos/${repo}/issues/${pr}/labels`, "-f", `labels[]=${LABEL}`)
  const body = renderComment(reasons, headSha)
  const existing = gh(
    "api",
    "--paginate",
    `repos/${repo}/issues/${pr}/comments`,
    "--jq",
    `.[] | select(.user.login == "github-actions[bot]" and (.body | contains("${MARKER}"))) | .id`,
  )
    .split("\n")
    .filter(Boolean)[0]
  if (existing) gh("api", "-X", "PATCH", `repos/${repo}/issues/comments/${existing}`, "-f", `body=${body}`)
  else gh("api", "-X", "POST", `repos/${repo}/issues/${pr}/comments`, "-f", `body=${body}`)
}

const PR_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      headRefName
      headRefOid
      autoMergeRequest { enabledAt }
      labels(first: 100) { nodes { name } }
    }
  }
}`

function livePr(repo, pr) {
  const [owner, name] = repo.split("/")
  const res = JSON.parse(
    gh("api", "graphql", "-f", `query=${PR_QUERY}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${pr}`),
  )
  const p = res.data.repository.pullRequest
  return {
    headRef: p.headRefName,
    headSha: p.headRefOid,
    autoMergeEnabled: p.autoMergeRequest != null,
    labels: p.labels.nodes.map((l) => l.name),
  }
}

function verifyStateOf(repo, sha) {
  // The combined status lists the newest status per context.
  const out = gh(
    "api",
    "--paginate",
    `repos/${repo}/commits/${sha}/status?per_page=100`,
    "--jq",
    `.statuses[] | select(.context == "${VERIFY_CONTEXT}") | .state`,
  ).trim()
  return out ? out.split("\n")[0] : null
}

function run(args) {
  const repo = args.repo ?? process.env.GITHUB_REPOSITORY
  const pr = Number(args.pr)
  const action = args.action ?? "synchronize"
  if (!repo || !Number.isInteger(pr) || pr <= 0) {
    console.error(`run needs --repo owner/name and --pr <number>.\n\n${HELP}`)
    return 2
  }
  if (!process.env.GH_TOKEN && process.env.GITHUB_TOKEN) process.env.GH_TOKEN = process.env.GITHUB_TOKEN

  let live = livePr(repo, pr)
  let flaggedNow = []
  let detection = `skipped (\`${action}\` does not change code)`
  if (DETECT_ACTIONS.includes(action)) {
    flaggedNow = detectionFor(repo, pr, live.headSha, args["base-dir"] ?? ".")
    detection = flaggedNow.length ? `${flaggedNow.length} irreversible change(s) found` : "nothing irreversible found"
    if (flaggedNow.length) {
      try {
        flagPr(repo, pr, flaggedNow, live.headSha, live.labels)
      } catch (e) {
        // The gate still fails through flaggedNow; say why the label/comment is missing.
        console.log(`::warning::Could not label or comment on #${pr}: ${String(e.stderr || e.message).trim()}`)
      }
      live = livePr(repo, pr)
    }
  }

  const result = decideGate({ ...live, verifyState: verifyStateOf(repo, live.headSha), pr, flaggedNow })
  const summary = renderSummary(result, { pr, headSha: live.headSha, action, detection })
  console.log(summary)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
  if (!result.pass) for (const r of result.reasons) console.log(`::error title=merge-gate::${r.replace(/\n/g, " ")}`)
  return result.pass ? 0 : 1
}

function detect(args) {
  if (!args.diff) {
    console.error(`detect needs --diff <file>.\n\n${HELP}`)
    return 2
  }
  const baseDir = args["base-dir"] ?? "."
  const files = parseDiff(readFileSync(args.diff, "utf8"))
  const reasons = detectIrreversible({
    files,
    isEnvKnown: envKnownIn(baseDir),
    headSource: (p) => {
      try {
        return readFileSync(p, "utf8")
      } catch {
        return null
      }
    },
  })
  if (!reasons.length) console.log("Nothing irreversible found.")
  else console.log([IRREVERSIBLE_NOTICE, "", ...reasons.map((r) => `- ${r}`)].join("\n"))
  return reasons.length ? 1 : 0
}

export function main(argv) {
  const args = parseArgs(argv)
  if (args.help || !args._.length) {
    console.log(HELP)
    return args.help ? 0 : 2
  }
  if (args._[0] === "run") {
    try {
      return run(args)
    } catch (e) {
      const err = /** @type {{ stderr?: string, message: string }} */ (e)
      console.log(
        `::error title=merge-gate::Could not read or update the PR through the GitHub API: ${String(err.stderr || err.message).trim()}. ` +
          "Fix: re-run the job; if it fails again, check the workflow's `permissions:` (contents: read, pull-requests: write, issues: write, statuses: read) and that `gh` is on the runner.",
      )
      return 1
    }
  }
  if (args._[0] === "detect") return detect(args)
  console.error(`Unknown command \`${args._[0]}\`.\n\n${HELP}`)
  return 2
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
