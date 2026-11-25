#!/usr/bin/env node
// verify-workout: launch, doctor, drive and clean up the Workout app for verification.
//
//   node .claude/skills/verify-workout/verify.mjs launch   [--port 3210] [--rebuild]
//   node .claude/skills/verify-workout/verify.mjs doctor   [--base-url <url>]
//   node .claude/skills/verify-workout/verify.mjs run      [--feature <id> ...] [--base-url <url>] [--out <dir>] [--keep-server]
//   node .claude/skills/verify-workout/verify.mjs features
//   node .claude/skills/verify-workout/verify.mjs cleanup
//
// Target: --base-url (or BASE_URL) drives a deployment, normally the PR's Vercel preview,
// with E2E_AUTH_SECRET = that deployment's AUTH_SECRET and VERCEL_AUTOMATION_BYPASS_SECRET.
// Without one, `run` drives the local server from `launch`, starting one itself if none is
// up (and stopping only that one afterwards). See SKILL.md.
import { spawn, spawnSync, execFileSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import net from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"

const SKILL_DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(SKILL_DIR, "../../..")
const STATE_DIR = path.join(ROOT, "node_modules/.cache/verify-workout")
const STATE_FILE = path.join(STATE_DIR, "server.json")
const BUILD_STAMP = path.join(ROOT, ".next/verify-workout-build.json")
const CONFIG = path.join(SKILL_DIR, "playwright.config.ts")
const FEATURES_DIR = path.join(SKILL_DIR, "features")
const JOURNEYS_DIR = path.join(SKILL_DIR, "journeys")
const DEFAULT_PORT = 3210
const PRODUCTION_HOSTS = ["workout.codesaif.dev"]

// ---------------------------------------------------------------- args & utils

function parseArgs(argv) {
  const [cmd, ...rest] = argv
  const opts = { features: [] }
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    const next = () => {
      const v = rest[++i]
      if (v === undefined) die(`${a} needs a value`)
      return v
    }
    if (a === "--feature" || a === "-f") opts.features.push(...next().split(","))
    else if (a === "--base-url") opts.baseUrl = next()
    else if (a === "--out") opts.out = next()
    else if (a === "--port") opts.port = Number(next())
    else if (a === "--rebuild") opts.rebuild = true
    else if (a === "--keep-server") opts.keepServer = true
    else if (a === "--workers") opts.workers = next()
    else if (a === "-h" || a === "--help") opts.help = true
    else die(`unknown argument: ${a}`)
  }
  return { cmd, opts }
}

function die(msg) {
  console.error(`verify-workout: ${msg}`)
  process.exit(2)
}

const log = (msg) => console.log(`[verify-workout] ${msg}`)

function git(...args) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {
    return ""
  }
}

/** HEAD plus a hash of uncommitted app changes: what a local build was built from. */
function sourceRevision() {
  const sha = git("rev-parse", "HEAD")
  const dirty = git("status", "--porcelain", "--", "src", "public", "next.config.ts", "package.json", "pnpm-lock.yaml")
  const diff = dirty ? git("diff", "HEAD", "--", "src", "public", "next.config.ts", "package.json") : ""
  const hash = dirty ? crypto.createHash("sha1").update(dirty + diff).digest("hex").slice(0, 8) : ""
  return { sha, dirty: Boolean(dirty), rev: dirty ? `${sha}+dirty.${hash}` : sha }
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
  } catch {
    return null
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function portInUse(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: "127.0.0.1" })
    sock.once("connect", () => {
      sock.destroy()
      resolve(true)
    })
    sock.once("error", () => resolve(false))
  })
}

/** PIDs listening on a TCP port, from /proc (Linux) or lsof; empty when unknown. */
function listenerPids(port) {
  // /proc first: sandboxes (like the cloud VM) often have lsof/ss that see nothing.
  const inodes = new Set()
  const hexPort = port.toString(16).toUpperCase().padStart(4, "0")
  for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let text = ""
    try {
      text = fs.readFileSync(table, "utf8")
    } catch {
      continue
    }
    for (const line of text.split("\n").slice(1)) {
      const cols = line.trim().split(/\s+/)
      // local_address is HEXIP:HEXPORT; state 0A is LISTEN; column 9 is the inode.
      if (cols[1]?.endsWith(`:${hexPort}`) && cols[3] === "0A") inodes.add(cols[9])
    }
  }
  if (inodes.size) {
    const pids = []
    for (const pid of fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
      try {
        for (const fd of fs.readdirSync(`/proc/${pid}/fd`)) {
          const link = fs.readlinkSync(`/proc/${pid}/fd/${fd}`)
          const m = /^socket:\[(\d+)\]$/.exec(link)
          if (m && inodes.has(m[1])) {
            pids.push(Number(pid))
            break
          }
        }
      } catch {}
    }
    if (pids.length) return pids
  }
  const r = spawnSync("lsof", ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" })
  if (r.status === 0) return r.stdout.split("\n").filter(Boolean).map(Number)
  const r2 = spawnSync("ss", ["-ltnpH", `sport = :${port}`], { encoding: "utf8" })
  if (r2.status === 0) return [...r2.stdout.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1]))
  return []
}

function descendants(pid) {
  const r = spawnSync("ps", ["-e", "-o", "pid=,ppid="], { encoding: "utf8" })
  if (r.status !== 0) return []
  const kids = new Map()
  for (const line of r.stdout.split("\n")) {
    const [p, pp] = line.trim().split(/\s+/).map(Number)
    if (!p) continue
    if (!kids.has(pp)) kids.set(pp, [])
    kids.get(pp).push(p)
  }
  const out = []
  const stack = [pid]
  while (stack.length) {
    const cur = stack.pop()
    for (const k of kids.get(cur) ?? []) {
      out.push(k)
      stack.push(k)
    }
  }
  return out
}

async function forgeSessionCookie(baseUrl, secret) {
  const { encode } = await import("next-auth/jwt")
  const secure = new URL(baseUrl).protocol === "https:"
  const name = secure ? "__Secure-authjs.session-token" : "authjs.session-token"
  const value = await encode({
    token: { sub: "e2e-smoke", name: "E2E Smoke", email: "e2e-smoke@example.invalid" },
    secret,
    salt: name,
  })
  return `${name}=${value}`
}

function bypassHeaders() {
  // Plain fetches get only the bypass header: x-vercel-set-bypass-cookie would turn
  // every answer into a 307 that sets the cookie.
  const s = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  return s ? { "x-vercel-protection-bypass": s } : {}
}

// ---------------------------------------------------------------- launch / cleanup

async function launch({ port = DEFAULT_PORT, rebuild = false } = {}) {
  const existing = readState()
  if (existing && alive(existing.pid)) {
    log(`local server already running (pid ${existing.pid}) at ${existing.baseUrl}; reusing it`)
    return { state: existing, startedHere: false }
  }
  if (existing) fs.rmSync(STATE_FILE, { force: true })

  if (await portInUse(port)) {
    die(
      `port ${port} is already in use by a process this skill did not start (pids: ${listenerPids(port).join(", ") || "unknown"}). ` +
        `Refusing to drive or kill it. Pick another with --port.`,
    )
  }

  if (!fs.existsSync(path.join(ROOT, "node_modules/.bin/next"))) {
    log("installing dependencies (pnpm install --frozen-lockfile)")
    run1("pnpm", ["install", "--frozen-lockfile"])
  }

  const rev = sourceRevision()
  let stamp = null
  try {
    stamp = JSON.parse(fs.readFileSync(BUILD_STAMP, "utf8"))
  } catch {}
  const haveBuild = fs.existsSync(path.join(ROOT, ".next/BUILD_ID"))
  if (rebuild || !haveBuild || !stamp || stamp.rev !== rev.rev) {
    log(`building ${rev.rev} (next build; needs no secrets)`)
    run1(path.join(ROOT, "node_modules/.bin/next"), ["build"], { NEXT_TELEMETRY_DISABLED: "1" })
    fs.writeFileSync(BUILD_STAMP, JSON.stringify({ rev: rev.rev, builtAt: new Date().toISOString() }))
  } else {
    log(`reusing the existing build of ${rev.rev}`)
  }

  fs.mkdirSync(STATE_DIR, { recursive: true })
  const logFile = path.join(STATE_DIR, `server-${port}.log`)
  const fd = fs.openSync(logFile, "w")
  // A secret chosen per launch: journeys forge their session cookie with the same value.
  const authSecret = crypto.randomBytes(32).toString("hex")
  const child = spawn(process.execPath, [path.join(ROOT, "node_modules/next/dist/bin/next"), "start", "-p", String(port)], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", fd, fd],
    env: {
      ...process.env,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      AUTH_SECRET: authSecret,
      AUTH_TRUST_HOST: "true",
      AUTH_GOOGLE_ID: "verify-workout-dummy",
      AUTH_GOOGLE_SECRET: "verify-workout-dummy",
      // Unroutable on purpose: the server can never reach a real KV store. Journeys
      // answer /api/** in the browser anyway; this is the second wall.
      KV_REST_API_URL: "http://127.0.0.1:1",
      KV_REST_API_TOKEN: "verify-workout-dummy",
      // No planner, push or cron credentials: those paths are faked in the browser.
      PLANNER_API_KEY: "",
      VAPID_PRIVATE_KEY: "",
      CRON_SECRET: "",
    },
  })
  child.unref()
  const state = {
    pid: child.pid,
    port,
    baseUrl: `http://localhost:${port}`,
    authSecret,
    rev: rev.rev,
    sha: rev.sha,
    logFile,
    startedAt: new Date().toISOString(),
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
  log(`started next start (pid ${child.pid}) on ${state.baseUrl}; log: ${path.relative(ROOT, logFile)}`)

  // Ready means usable: /welcome renders AND a forged session reaches Home (not a redirect).
  const deadline = Date.now() + 120_000
  const cookie = await forgeSessionCookie(state.baseUrl, authSecret)
  for (;;) {
    if (!alive(child.pid)) {
      die(`server exited during startup; see ${logFile}:\n${fs.readFileSync(logFile, "utf8").slice(-2000)}`)
    }
    try {
      const w = await fetch(`${state.baseUrl}/welcome`, { redirect: "manual" })
      const h = await fetch(`${state.baseUrl}/`, { redirect: "manual", headers: { cookie } })
      if (w.status === 200 && h.status === 200) break
    } catch {}
    if (Date.now() > deadline) die(`server not ready after 120s; see ${logFile}`)
    await new Promise((r) => setTimeout(r, 500))
  }
  log(`ready: ${state.baseUrl}`)
  return { state, startedHere: true }
}

function run1(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", env: { ...process.env, ...env } })
  if (r.status !== 0) die(`${path.basename(cmd)} ${args.join(" ")} failed (exit ${r.status})`)
}

async function cleanup() {
  const state = readState()
  if (!state) {
    log("no local server recorded as started by this skill; nothing to stop")
  } else if (!alive(state.pid)) {
    log(`recorded server pid ${state.pid} is already gone`)
  } else {
    // Only the process this skill spawned, its process group and its children; never by name.
    const pids = [state.pid, ...descendants(state.pid)]
    try {
      process.kill(-state.pid, "SIGTERM")
    } catch {
      for (const p of pids) try { process.kill(p, "SIGTERM") } catch {}
    }
    const deadline = Date.now() + 10_000
    while (pids.some(alive) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200))
    for (const p of pids.filter(alive)) try { process.kill(p, "SIGKILL") } catch {}
    log(`stopped local server pid ${state.pid} (port ${state.port})`)
  }
  fs.rmSync(STATE_FILE, { force: true })
  const evidenceRoot = path.join(ROOT, "verify-evidence")
  if (fs.existsSync(evidenceRoot)) {
    log(`evidence kept: ${fs.readdirSync(evidenceRoot).map((d) => `verify-evidence/${d}`).join(", ")}`)
  }
}

// ---------------------------------------------------------------- doctor

async function doctor(target) {
  const checks = []
  const ok = (name, detail) => checks.push({ ok: true, name, detail })
  const bad = (name, detail) => checks.push({ ok: false, name, detail })
  const url = new URL(target.baseUrl)

  if (PRODUCTION_HOSTS.includes(url.hostname)) bad("target", `${url.host} is production: verify a preview or a local server`)
  else ok("target", `${target.baseUrl} (${target.kind})`)

  if (target.kind === "local") {
    const st = target.state
    if (alive(st.pid)) ok("process", `pid ${st.pid} alive`)
    else bad("process", `pid ${st.pid} is gone; run cleanup, then launch`)
    const owners = listenerPids(st.port)
    const ours = [st.pid, ...descendants(st.pid)]
    if (owners.length === 0) bad("port", `nothing listening on ${st.port}`)
    else if (owners.some((p) => ours.includes(p))) ok("port", `${st.port} owned by our server`)
    else bad("port", `${st.port} is owned by pid ${owners.join(",")}, not ours`)
    const rev = sourceRevision()
    if (st.rev === rev.rev) ok("build", `built from ${st.rev}`)
    else bad("build", `server built from ${st.rev} but the checkout is ${rev.rev}: run cleanup, then launch`)
  } else {
    if (url.hostname.endsWith(".vercel.app") && !process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
      bad("bypass", "VERCEL_AUTOMATION_BYPASS_SECRET is not set; protected previews answer 401")
    } else ok("bypass", process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? "bypass secret set" : "no bypass secret (unprotected target)")
  }

  try {
    const res = await fetch(new URL("/welcome", url), { headers: bypassHeaders(), redirect: "manual" })
    const html = await res.text()
    if (res.status === 200 && html.includes("best workout tracker")) ok("welcome", "GET /welcome 200, Workout welcome page")
    else bad("welcome", `GET /welcome → ${res.status}${res.status === 401 ? " (Vercel protection: bypass secret missing/wrong)" : ""}`)
  } catch (e) {
    bad("welcome", `GET /welcome failed: ${e.message}`)
  }

  try {
    const res = await fetch(new URL("/manifest.webmanifest", url), { headers: bypassHeaders(), redirect: "manual" })
    const m = res.status === 200 ? await res.json() : null
    if (m?.display === "standalone") ok("manifest", `PWA manifest "${m.name}"`)
    else bad("manifest", `GET /manifest.webmanifest → ${res.status}`)
  } catch (e) {
    bad("manifest", `GET /manifest.webmanifest failed: ${e.message}`)
  }

  if (!target.authSecret) {
    bad("auth", "E2E_AUTH_SECRET is not set: it must equal the deployment's AUTH_SECRET")
  } else {
    try {
      const cookie = await forgeSessionCookie(target.baseUrl, target.authSecret)
      const res = await fetch(new URL("/", url), { headers: { ...bypassHeaders(), cookie }, redirect: "manual" })
      if (res.status === 200) ok("auth", "forged Auth.js session reaches Home (secret matches)")
      else bad("auth", `forged session got ${res.status} → ${res.headers.get("location") ?? ""}: E2E_AUTH_SECRET does not match the server's AUTH_SECRET`)
    } catch (e) {
      bad("auth", `GET / failed: ${e.message}`)
    }
  }

  try {
    const { chromium } = await import("@playwright/test")
    const exe = chromium.executablePath()
    if (fs.existsSync(exe)) ok("browser", `chromium at ${exe}`)
    else bad("browser", `chromium missing at ${exe}: pnpm exec playwright install chromium (not in the cloud VM, where it is preinstalled)`)
  } catch (e) {
    bad("browser", `@playwright/test not importable: ${e.message}`)
  }

  for (const c of checks) console.log(`  ${c.ok ? "ok  " : "FAIL"} ${c.name.padEnd(9)} ${c.detail}`)
  return checks.every((c) => c.ok)
}

// ---------------------------------------------------------------- features / run

function featureIds() {
  return fs
    .readdirSync(FEATURES_DIR)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .map((f) => f.replace(/\.md$/, ""))
    .sort()
}

function journeyTags() {
  const tags = new Map()
  for (const f of fs.readdirSync(JOURNEYS_DIR).filter((f) => f.endsWith(".journey.ts"))) {
    const src = fs.readFileSync(path.join(JOURNEYS_DIR, f), "utf8")
    for (const m of src.matchAll(/tag:\s*"@([\w-]+)"/g)) tags.set(m[1], f)
  }
  return tags
}

async function resolveTarget(opts) {
  const baseUrl = opts.baseUrl ?? process.env.BASE_URL
  if (baseUrl) return { kind: "deployed", baseUrl: baseUrl.replace(/\/$/, ""), authSecret: process.env.E2E_AUTH_SECRET }
  const state = readState()
  if (state && alive(state.pid)) return { kind: "local", baseUrl: state.baseUrl, authSecret: state.authSecret, state }
  return null
}

function utcStamp() {
  return new Date().toISOString().replace(/[:]/g, "").replace(/\.\d+Z$/, "Z")
}

async function runJourneys(opts) {
  const known = featureIds()
  const tags = journeyTags()
  const wanted = opts.features.length ? opts.features : known
  for (const f of wanted) {
    if (!known.includes(f)) die(`unknown feature "${f}"; see \`verify.mjs features\``)
    if (!tags.has(f)) die(`feature "${f}" has no journey tagged @${f} in journeys/`)
  }

  let target = await resolveTarget(opts)
  let startedHere = false
  if (!target) {
    const launched = await launch({ port: opts.port })
    startedHere = launched.startedHere
    target = await resolveTarget(opts)
  }

  const out = path.resolve(opts.out ?? path.join(ROOT, "verify-evidence", utcStamp()))
  fs.mkdirSync(out, { recursive: true })
  const rev = sourceRevision()
  log(`target ${target.baseUrl} (${target.kind}); evidence → ${path.relative(ROOT, out) || out}`)

  let exitCode = 1
  try {
    log("doctor")
    if (!(await doctor(target))) {
      fs.writeFileSync(path.join(out, "summary.md"), `# verify-workout\n\nDoctor failed for ${target.baseUrl}; no journeys ran.\n`)
      console.error("verify-workout: doctor failed; fix the target before driving it")
      exitCode = 3
    } else {
      const grep = `@(${wanted.join("|")})(\\s|$)`
      const args = [path.join(ROOT, "node_modules/@playwright/test/cli.js"), "test", "-c", CONFIG, "--grep", grep]
      if (opts.workers) args.push("--workers", opts.workers)
      log(`playwright test -c ${path.relative(ROOT, CONFIG)} --grep "${grep}"`)
      const outFile = fs.createWriteStream(path.join(out, "test-output.txt"))
      const child = spawn(process.execPath, args, {
        cwd: ROOT,
        env: {
          ...process.env,
          BASE_URL: target.baseUrl,
          E2E_AUTH_SECRET: target.authSecret ?? "",
          VERIFY_OUT: out,
          FORCE_COLOR: "0",
          CI: "",
        },
        stdio: ["ignore", "pipe", "pipe"],
      })
      for (const s of [child.stdout, child.stderr]) {
        s.on("data", (d) => {
          process.stdout.write(d)
          outFile.write(d)
        })
      }
      exitCode = await new Promise((r) => child.on("close", (code) => r(code ?? 1)))
      outFile.end()
      writeSummary({ out, target, rev, wanted, exitCode })
    }
  } finally {
    if (startedHere && !opts.keepServer) await cleanup()
    else if (target.kind === "local") log(`local server left running (pid ${target.state.pid}); stop it with \`verify.mjs cleanup\``)
  }
  log(`evidence: ${path.join(path.relative(ROOT, out), "summary.md")}`)
  process.exit(exitCode)
}

function writeSummary({ out, target, rev, wanted, exitCode }) {
  let results = null
  try {
    results = JSON.parse(fs.readFileSync(path.join(out, "results.json"), "utf8"))
  } catch {}
  const rel = (p) => path.relative(out, p)
  const rows = []
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const tag = ((spec.tags ?? [])[0] ?? "untagged").replace(/^@/, "")
        const r = t.results?.[t.results.length - 1] ?? {}
        const featDir = path.join(out, tag)
        fs.mkdirSync(featDir, { recursive: true })
        for (const a of r.attachments ?? []) {
          if (!a.path || !fs.existsSync(a.path)) continue
          // Journeys write their screenshots straight into the feature dir; copy what
          // Playwright recorded on its own (video, failure screenshot, trace) next to them.
          if (a.name === "video") fs.copyFileSync(a.path, path.join(featDir, "video.webm"))
          else if (a.name === "trace" || a.name === "screenshot") fs.copyFileSync(a.path, path.join(featDir, `failure-${a.name}${path.extname(a.path)}`))
        }
        const artifacts = fs.readdirSync(featDir).sort().map((f) => rel(path.join(featDir, f)))
        const err = r.error?.message ? r.error.message.split("\n")[0].replace(/\|/g, "\\|").slice(0, 160) : ""
        rows.push({ feature: tag, title: spec.title, status: r.status ?? "not run", ms: r.duration ?? 0, artifacts, err })
      }
    }
    for (const s of suite.suites ?? []) visit(s)
  }
  for (const s of results?.suites ?? []) visit(s)
  for (const f of wanted) if (!rows.some((r) => r.feature === f)) rows.push({ feature: f, title: "", status: "not run", ms: 0, artifacts: [], err: "" })
  rows.sort((a, b) => a.feature.localeCompare(b.feature))

  const passed = rows.filter((r) => r.status === "passed").length
  const lines = [
    "# verify-workout evidence",
    "",
    `- Target: ${target.baseUrl} (${target.kind === "local" ? "local `next start` launched by verify.mjs" : "deployed"})`,
    `- Git SHA: ${rev.rev}`,
    `- Run at (UTC): ${new Date().toISOString()}`,
    `- Result: ${passed}/${rows.length} features passed (playwright exit ${exitCode})`,
    `- Raw output: test-output.txt; machine-readable: results.json`,
    "",
    "| Feature | Result | Time | Artifacts |",
    "|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| \`${r.feature}\` | ${r.status === "passed" ? "pass" : `**${r.status.toUpperCase()}**`}${r.err ? `: ${r.err}` : ""} | ${(r.ms / 1000).toFixed(1)}s | ${r.artifacts.map((a) => `\`${a}\``).join("<br>")} |`,
    ),
    "",
  ]
  fs.writeFileSync(path.join(out, "summary.md"), lines.join("\n"))
}

// ---------------------------------------------------------------- main

const { cmd, opts } = parseArgs(process.argv.slice(2))
if (!cmd || opts.help) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 13).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"))
  process.exit(cmd ? 0 : 2)
}

switch (cmd) {
  case "launch":
    await launch({ port: opts.port ?? DEFAULT_PORT, rebuild: opts.rebuild })
    break
  case "doctor": {
    const target = await resolveTarget(opts)
    if (!target) die("no target: pass --base-url (or BASE_URL), or start a local server with `verify.mjs launch`")
    process.exit((await doctor(target)) ? 0 : 1)
    break
  }
  case "run":
    await runJourneys(opts)
    break
  case "features": {
    const tags = journeyTags()
    for (const f of featureIds()) console.log(`${f.padEnd(22)} ${tags.has(f) ? `journeys/${tags.get(f)}` : "NO JOURNEY"}`)
    break
  }
  case "cleanup":
    await cleanup()
    break
  default:
    die(`unknown command "${cmd}"`)
}
