#!/usr/bin/env node
// verify-workout fuzz: seeded, read-only monkey testing of the Workout app.
//
//   node .claude/skills/verify-workout/fuzz/fuzz.mjs run [--base-url <url>] [--allow-production] [--seed <int>]
//        [--minutes <n>] [--max-actions <n per feature>] [--feature <id> ...] [--out <dir>] [--signed-out-only]
//        [--keep-server] [--port <n>]
//   node .claude/skills/verify-workout/fuzz/fuzz.mjs selftest     # the safety wall against a local server
//
// No --base-url (or BASE_URL): launches/reuses the local server exactly like verify.mjs.
// Production needs --allow-production; without E2E_AUTH_SECRET only the signed-out surface
// is fuzzed. Exit 0 = the run completed (with or without findings), 2 = harness or target
// error (bad arguments, guard refusal, doctor failure, harness crash). See SKILL.md, "Fuzz".
import { spawn } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { launch, cleanup, doctor, readState, journeyTags, utcStamp, bypassHeaders, DEFAULT_PORT } from "../verify.mjs"
import { checkFuzzTarget } from "../lib/target.mjs"
import { BLOCKED_KINDS } from "./lib/classify.mjs"
import { featureIds, loadRoutes, planPhases, protectedRoutes } from "./lib/map.mjs"
import { loadKnownIssues, redact, renderSummary } from "./lib/report.mjs"
import { findingSignature, routePattern } from "./lib/signature.mjs"

const FUZZ_DIR = path.dirname(fileURLToPath(import.meta.url))
const SKILL_DIR = path.resolve(FUZZ_DIR, "..")
const ROOT = path.resolve(SKILL_DIR, "../../..")
const FUZZ_CONFIG = path.join(FUZZ_DIR, "playwright.config.ts")
const VERIFY_CONFIG = path.join(SKILL_DIR, "playwright.config.ts")
const PLAYWRIGHT = path.join(ROOT, "node_modules/@playwright/test/cli.js")
const PUBLIC_MONKEYS = [
  { id: "public-welcome", feature: "signed-out", route: "/welcome", signedIn: false },
  { id: "public-onboarding", feature: "signed-out", route: "/onboarding", signedIn: false },
]

// ---------------------------------------------------------------- args & output

class HarnessError extends Error {}

function parseArgs(argv) {
  const [cmd, ...rest] = argv
  const opts = { features: [], allowProduction: false, signedOutOnly: false, keepServer: false }
  const int = (flag, v, min) => {
    if (!/^-?\d+$/.test(v) || Number(v) < min) throw new HarnessError(`${flag} needs an integer ≥ ${min}, got "${v}"`)
    return Number(v)
  }
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    const next = () => {
      const v = rest[++i]
      if (v === undefined) throw new HarnessError(`${a} needs a value`)
      return v
    }
    if (a === "--base-url") opts.baseUrl = next()
    else if (a === "--allow-production") opts.allowProduction = true
    else if (a === "--seed") opts.seed = int(a, next(), 0)
    else if (a === "--minutes") opts.minutes = Number(next())
    else if (a === "--max-actions") opts.maxActions = int(a, next(), 1)
    else if (a === "--feature" || a === "-f") opts.features.push(...next().split(",").filter(Boolean))
    else if (a === "--out") opts.out = next()
    else if (a === "--signed-out-only") opts.signedOutOnly = true
    else if (a === "--keep-server") opts.keepServer = true
    else if (a === "--port") opts.port = int(a, next(), 1)
    else if (a === "-h" || a === "--help") opts.help = true
    else throw new HarnessError(`unknown argument: ${a}`)
  }
  if (opts.minutes !== undefined && !(opts.minutes > 0)) throw new HarnessError("--minutes needs a positive number")
  return { cmd, opts }
}

/** Secrets this process knows, by name: every line printed or written goes through redact(). */
const secrets = {
  E2E_AUTH_SECRET: process.env.E2E_AUTH_SECRET ?? "",
  VERCEL_AUTOMATION_BYPASS_SECRET: process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? "",
}
const say = (msg) => console.log(redact(`[fuzz] ${msg}`, secrets))
const writeText = (file, text) => fs.writeFileSync(file, redact(text, secrets))

function usage() {
  return fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 12).map((l) => l.replace(/^\/\/ ?/, "")).join("\n")
}

/** Run Playwright with `args`, mirroring redacted output to the console and `logFile`. */
function playwright(args, env, logFile) {
  return new Promise((resolve) => {
    const log = fs.createWriteStream(logFile)
    const child = spawn(process.execPath, [PLAYWRIGHT, "test", ...args], {
      cwd: ROOT,
      env: { ...process.env, ...env, FORCE_COLOR: "0", CI: "" },
      stdio: ["ignore", "pipe", "pipe"],
    })
    for (const s of [child.stdout, child.stderr]) {
      s.on("data", (d) => {
        const text = redact(d.toString(), secrets)
        process.stdout.write(text)
        log.write(text)
      })
    }
    child.on("close", (code) => {
      log.end()
      resolve(code ?? 1)
    })
  })
}

const readJson = (file, fallback = null) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    return fallback
  }
}

// ---------------------------------------------------------------- target

async function resolveFuzzTarget(opts) {
  const baseUrl = (opts.baseUrl ?? process.env.BASE_URL)?.replace(/\/$/, "")
  if (baseUrl) {
    const guard = checkFuzzTarget(baseUrl, { allowProduction: opts.allowProduction })
    if (!guard.ok) throw new HarnessError(`refusing ${baseUrl}: ${guard.reason}`)
    return { kind: "deployed", baseUrl, authSecret: process.env.E2E_AUTH_SECRET || undefined, production: guard.production, startedHere: false }
  }
  // Same launch code as verify.mjs: reuse our server or start one (never someone else's).
  let state = readState()
  let startedHere = false
  if (!state || !isAlive(state.pid)) {
    const launched = await launch({ port: opts.port ?? DEFAULT_PORT })
    state = launched.state
    startedHere = launched.startedHere
  }
  const guard = checkFuzzTarget(state.baseUrl)
  if (!guard.ok) throw new HarnessError(`refusing ${state.baseUrl}: ${guard.reason}`)
  secrets.AUTH_SECRET = state.authSecret
  return { kind: "local", baseUrl: state.baseUrl, authSecret: state.authSecret, production: false, state, startedHere }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** The run's only real request to a data route: unauthenticated, read-only, must be a 401 JSON. */
async function checkUnauthenticatedApi(baseUrl) {
  const route = "/api/profile"
  const res = await fetch(new URL(route, baseUrl), { headers: bypassHeaders(), redirect: "manual" })
  const type = res.headers.get("content-type") ?? ""
  const body = await res.text()
  let json = null
  try {
    json = JSON.parse(body)
  } catch {}
  const ok = res.status === 401 && type.includes("json") && json !== null
  return { ok, route, detail: `GET ${route} without a cookie → ${res.status} ${type}` }
}

// ---------------------------------------------------------------- run

async function run(opts) {
  const startedAt = new Date()
  const seed = opts.seed ?? crypto.randomInt(0, 2 ** 31)
  const minutes = opts.minutes ?? 10
  const maxActions = opts.maxActions ?? 40

  const known = featureIds()
  const routes = loadRoutes()
  const wanted = opts.features.length ? opts.features : known
  for (const f of wanted) {
    if (!known.includes(f)) throw new HarnessError(`unknown feature "${f}"; ids are the files in features/`)
    if (!routes[f]) throw new HarnessError(`feature "${f}" has no entry in features/routes.json`)
  }

  const target = await resolveFuzzTarget(opts)
  const out = path.resolve(opts.out ?? path.join(ROOT, "verify-evidence", `fuzz-${utcStamp()}`))
  fs.rmSync(path.join(out, "parts"), { recursive: true, force: true })
  fs.mkdirSync(path.join(out, "parts"), { recursive: true })
  say(`target ${target.baseUrl} (${target.kind}${target.production ? ", PRODUCTION, read-only" : ""}); seed ${seed}; out ${path.relative(ROOT, out) || out}`)

  const optionString = [
    opts.baseUrl ? ` --base-url ${opts.baseUrl}` : "",
    opts.allowProduction ? " --allow-production" : "",
    ` --minutes ${minutes} --max-actions ${maxActions}`,
    opts.features.length ? opts.features.map((f) => ` --feature ${f}`).join("") : "",
    opts.signedOutOnly ? " --signed-out-only" : "",
  ].join("")

  const report = {
    target: target.baseUrl,
    production: target.production,
    seed,
    startedAt: startedAt.toISOString(),
    durationMs: 0,
    options: optionString,
    phases: planPhases({ authSecret: target.authSecret, signedOutOnly: opts.signedOutOnly }),
    journeys: [],
    monkeys: [],
    actions: 0,
    blockedRequests: Object.fromEntries(BLOCKED_KINDS.map((k) => [k, 0])),
    apiLeaks: 0,
    unansweredDataRequests: 0,
    harnessInduced: 0,
    findings: [],
    errors: [],
  }
  const signedOut = report.phases[0]
  const signedIn = report.phases[1]
  const finish = (exitCode) => {
    report.durationMs = Date.now() - startedAt.getTime()
    writeText(path.join(out, "fuzz-report.json"), JSON.stringify(report, null, 2))
    writeText(path.join(out, "summary.md"), renderSummary(report) + (report.errors.length ? `\n## Harness errors\n\n${report.errors.map((e) => `- ${e}`).join("\n")}\n` : ""))
    say(`report: ${path.relative(ROOT, path.join(out, "fuzz-report.json"))}; summary: ${path.relative(ROOT, path.join(out, "summary.md"))}`)
    return exitCode
  }

  try {
    say("doctor")
    if (!(await doctor(target, { allowProduction: target.production, requireAuth: false }))) {
      report.errors.push("doctor failed for the target; nothing was driven")
      for (const p of report.phases) if (p.status === "pending") Object.assign(p, { status: "skipped", skippedReason: "doctor failed" })
      return finish(2)
    }

    // 1a. The only real request to a data route: unauthenticated, read-only.
    const unauth = await checkUnauthenticatedApi(target.baseUrl)
    say(`${unauth.ok ? "ok  " : "FAIL"} ${unauth.detail}`)
    if (!unauth.ok) {
      const message = `${unauth.detail}, expected 401 JSON`
      report.findings.push({
        signature: findingSignature({ kind: "api-unauthenticated", route: unauth.route, message }),
        kind: "api-unauthenticated",
        feature: "signed-out",
        route: routePattern(unauth.route),
        message,
        reproducible: !(await checkUnauthenticatedApi(target.baseUrl)).ok,
        known: null,
        steps: [`GET ${unauth.route} with no cookie (server-side fetch)`, `observe: ${message}`],
      })
    }

    // 2a. Journeys, once per selected feature, under the fuzz write wall.
    const tags = journeyTags()
    const env = {
      BASE_URL: target.baseUrl,
      E2E_AUTH_SECRET: target.authSecret ?? "",
    }
    if (signedIn.status === "pending") {
      const withJourney = wanted.filter((f) => tags.has(f))
      const jOut = path.join(out, "journeys")
      fs.mkdirSync(jOut, { recursive: true })
      say(`journeys: ${withJourney.length} features, one worker`)
      const code = await playwright(
        ["-c", VERIFY_CONFIG, "--grep", `@(${withJourney.join("|")})(\\s|$)`, "--workers", "1"],
        {
          ...env,
          VERIFY_OUT: jOut,
          VERIFY_FUZZ_GUARD: "1",
          VERIFY_FUZZ_PRODUCTION: target.production ? "1" : "",
          VERIFY_FUZZ_BLOCKED_DIR: path.join(out, "parts", "journey-blocked"),
        },
        path.join(jOut, "test-output.txt"),
      )
      report.journeys = readJourneys(path.join(jOut, "results.json"), withJourney, path.join(out, "parts", "journey-blocked"))
      for (const j of report.journeys) for (const b of j.blocked ?? []) report.blockedRequests[b.kind] = (report.blockedRequests[b.kind] ?? 0) + 1
      if (!report.journeys.length && code !== 0) report.errors.push(`journey run exited ${code} without results`)
    }

    // 1b + 2b. Signed-out checks and every monkey, in one Playwright run.
    const monkeys = [...PUBLIC_MONKEYS, ...(signedIn.status === "pending" ? wanted.map((f) => ({ id: f, feature: f, ...routes[f] })) : [])]
    const runConfig = {
      baseUrl: target.baseUrl,
      production: target.production,
      seed,
      out,
      deadline: Date.now() + minutes * 60_000,
      maxActions,
      trace: !target.production,
      monkeys,
      protectedRoutes: protectedRoutes(),
    }
    const cfgFile = path.join(out, "parts", "run-config.json")
    fs.writeFileSync(cfgFile, JSON.stringify(runConfig, null, 2))
    say(`signed-out checks, then ${monkeys.length} monkeys: ${minutes} min shared, ≤ ${maxActions} actions each`)
    const code = await playwright(
      ["-c", FUZZ_CONFIG, "--grep", "@fuzz-(signed-out|monkey)(\\s|$)"],
      { ...env, FUZZ_RUN_CONFIG: cfgFile, FUZZ_OUT: out },
      path.join(out, "fuzz-output.txt"),
    )
    if (code !== 0) report.errors.push(`fuzz run exited ${code}: a harness step crashed (see fuzz-output.txt)`)

    // Aggregate.
    const so = readJson(path.join(out, "parts", "signed-out.json"))
    if (!so) report.errors.push("signed-out checks wrote no results")
    const parts = [so, ...monkeys.map((m) => readJson(path.join(out, "parts", `monkey-${m.id.replace(/[^\w-]+/g, "_")}.json`)))].filter(Boolean)
    for (const m of monkeys) {
      const r = parts.find((p) => p.id === m.id)
      if (!r) report.errors.push(`monkey ${m.id} wrote no results`)
      else report.monkeys.push({ id: r.id, feature: r.feature, signedIn: r.signedIn, status: r.status, ...(r.skippedReason ? { skippedReason: r.skippedReason } : {}), actions: r.actions, state: r.state, findings: r.findings.length })
    }
    for (const p of parts) {
      report.actions += p.actions ?? 0
      report.findings.push(...p.findings.map((f) => ({ ...f, known: null })))
      for (const b of p.blocked) report.blockedRequests[b.kind] = (report.blockedRequests[b.kind] ?? 0) + 1
      report.apiLeaks += p.apiLeaks.length
      report.harnessInduced += p.harnessInduced?.length ?? 0
      report.unansweredDataRequests += Math.max(0, p.dataRequests.seen - p.dataRequests.answered)
    }

    const knownIssues = loadKnownIssues(path.join(FUZZ_DIR, "known-issues.json"))
    for (const f of report.findings) f.known = knownIssues[f.signature] ?? null

    const inPhase = (signedInPhase) => report.findings.filter((f) => (f.feature === "signed-out") !== signedInPhase)
    signedOut.status = !so ? "failed" : inPhase(false).length ? "failed" : "passed"
    if (signedIn.status === "pending") {
      const journeyFailed = report.journeys.some((j) => j.status === "failed")
      signedIn.status = inPhase(true).length || journeyFailed ? "failed" : "passed"
    }
    return finish(report.errors.length ? 2 : 0)
  } catch (e) {
    report.errors.push(String(e?.message ?? e))
    return finish(2)
  } finally {
    if (target.startedHere && !opts.keepServer) await cleanup()
  }
}

/**
 * Journey statuses from verify's JSON report. A journey that failed while the fuzz wall
 * blocked a write it made (e.g. the server action behind "i've done this before") is
 * `inconclusive`: it needed something a read-only run never sends.
 */
function readJourneys(resultsFile, wanted, blockedDir) {
  const results = readJson(resultsFile)
  const rows = []
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const feature = ((spec.tags ?? [])[0] ?? "untagged").replace(/^@/, "")
        const r = t.results?.[t.results.length - 1] ?? {}
        const blocked = (readJson(path.join(blockedDir, `${feature}.json`), []) ?? []).map((b) => ({ kind: b.kind, method: b.method, url: routePattern(b.url) }))
        let status = r.status ?? "not run"
        if (status !== "passed" && status !== "skipped" && blocked.length) status = "inconclusive"
        else if (status === "timedOut" || status === "interrupted") status = "failed"
        const error = r.error?.message ? r.error.message.replace(/\u001b\[[0-9;]*m/g, "").split("\n")[0].slice(0, 200) : undefined
        rows.push({ feature, status, ...(error ? { error } : {}), ...(blocked.length ? { blocked } : {}) })
      }
    }
    for (const s of suite.suites ?? []) visit(s)
  }
  for (const s of results?.suites ?? []) visit(s)
  for (const f of wanted) if (!rows.some((r) => r.feature === f)) rows.push({ feature: f, status: "not run" })
  return rows.sort((a, b) => a.feature.localeCompare(b.feature))
}

// ---------------------------------------------------------------- selftest

/** The safety wall end to end against a local server (never a deployment). */
async function selftest(opts) {
  if (opts.baseUrl || process.env.BASE_URL) throw new HarnessError("selftest runs against the local server only; drop --base-url / BASE_URL")
  const target = await resolveFuzzTarget({ ...opts, baseUrl: undefined })
  const out = path.resolve(opts.out ?? path.join(ROOT, "verify-evidence", `fuzz-selftest-${utcStamp()}`))
  fs.mkdirSync(path.join(out, "parts"), { recursive: true })
  const cfgFile = path.join(out, "parts", "run-config.json")
  fs.writeFileSync(
    cfgFile,
    JSON.stringify({ baseUrl: target.baseUrl, production: false, seed: opts.seed ?? 1, out, deadline: Date.now() + 5 * 60_000, maxActions: opts.maxActions ?? 25, trace: false, monkeys: [], protectedRoutes: [] }),
  )
  try {
    say(`selftest against ${target.baseUrl}`)
    const code = await playwright(
      ["-c", FUZZ_CONFIG, "--grep", "@fuzz-selftest"],
      { BASE_URL: target.baseUrl, E2E_AUTH_SECRET: target.authSecret, FUZZ_RUN_CONFIG: cfgFile, FUZZ_OUT: out },
      path.join(out, "selftest-output.txt"),
    )
    say(code === 0 ? "selftest passed" : "selftest FAILED")
    return code === 0 ? 0 : 1
  } finally {
    if (target.startedHere && !opts.keepServer) await cleanup()
  }
}

// ---------------------------------------------------------------- main

let exitCode = 2
try {
  const { cmd, opts } = parseArgs(process.argv.slice(2))
  if (!cmd || opts.help) {
    console.log(usage())
    exitCode = cmd ? 0 : 2
  } else if (cmd === "run") exitCode = await run(opts)
  else if (cmd === "selftest") exitCode = await selftest(opts)
  else throw new HarnessError(`unknown command "${cmd}"`)
} catch (e) {
  console.error(redact(`verify-workout fuzz: ${e?.message ?? e}`, secrets))
  exitCode = 2
}
process.exit(exitCode)
