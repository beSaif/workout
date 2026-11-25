import fs from "node:fs"
import path from "node:path"
import { devices, type Browser, type BrowserContext, type Page } from "@playwright/test"
import { FakeApi, installApiFake, isDataApi, signInContext, trackApiLeaks } from "../../../../e2e/fixtures"
import { installFuzzGuard, type BlockedRequest } from "./guard"
import { createRng, hashSeed } from "./lib/rng.mjs"
import { EDGE_INPUTS, FUZZ_USER, generateState } from "./lib/state.mjs"
import { findingSignature, routePattern } from "./lib/signature.mjs"
import { isAllowlisted, loadAllowlist } from "./lib/report.mjs"

/**
 * The fuzz engine: a seeded "monkey" that drives one feature's entry route like an
 * impatient user, checks invariants after every action, and on a violation records the
 * steps, a screenshot and (off production) a trace, then replays the same seed, state and
 * steps once in a fresh context to tell a reproducible bug from a flake.
 *
 * Every browser context it opens is new and non-persistent (browser.newContext, no
 * storageState), blocks service workers, answers /api data with e2e/fixtures.ts's FakeApi
 * (leaks tracked by its trackApiLeaks) and aborts every other write and every cross-origin
 * request (guard.ts).
 */

export type RunConfig = {
  baseUrl: string
  production: boolean
  seed: number
  out: string
  /** Epoch ms by which every monkey must have finished. */
  deadline: number
  maxActions: number
  trace: boolean
  monkeys: MonkeyTarget[]
  protectedRoutes: string[]
}

export type MonkeyTarget = { id: string; feature: string; route: string; signedIn: boolean }

type State = ReturnType<typeof generateState>

export type Finding = {
  signature: string
  kind: string
  feature: string
  route: string
  message: string
  reproducible: boolean
  steps: string[]
  screenshot?: string
  trace?: string
}

export type MonkeyResult = {
  id: string
  feature: string
  signedIn: boolean
  status: "passed" | "failed" | "skipped"
  skippedReason?: string
  actions: number
  state?: string
  findings: Finding[]
  blocked: BlockedRequest[]
  dataRequests: { seen: number; answered: number }
  apiLeaks: string[]
  /** Errors caused by the guard aborting a request (not findings). */
  harnessInduced?: string[]
}

type Target = { kind: string; role: string; name: string; nth: number; options?: number; inputType?: string; href?: string }
type Action =
  | { type: "element"; target: Target; value?: string; index?: number; submit?: boolean }
  | { type: "escape" | "back" | "forward" | "reload" }
  | { type: "scroll"; dy: number }
  | { type: "goto"; path: string; why: string }

type Violation = { kind: string; message: string }

const VIEWPORT = { width: 393, height: 852 }
const SPINNER_LIMIT_MS = 10_000
const allowlist = loadAllowlist(path.join(__dirname, "allowlist.json"))

// ---------------------------------------------------------------- contexts

export type Probe = {
  context: BrowserContext
  page: Page
  api: FakeApi
  origin: string
  blocked: BlockedRequest[]
  leaked: string[]
  data: { seen: number; answered: Set<unknown> }
  pageErrors: string[]
  consoleErrors: string[]
  serverErrors: string[]
  /** Network-failure errors the guard's own aborts caused (see NETWORK_FAILURE). */
  harnessInduced: string[]
  /** Console load errors for /api data responses, whose status the fake chose (not findings). */
  fakeAnswered: string[]
}

/** A fresh, non-persistent context with the fake, the leak tracker and the write wall. */
export async function openProbe(
  browser: Browser,
  cfg: Pick<RunConfig, "baseUrl" | "production">,
  { signedIn, state, trace = false }: { signedIn: boolean; state?: State | null; trace?: boolean },
): Promise<Probe> {
  const origin = new URL(cfg.baseUrl).origin
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  const context = await browser.newContext({
    ...devices["Desktop Chrome"],
    viewport: VIEWPORT,
    baseURL: cfg.baseUrl,
    serviceWorkers: "block",
    extraHTTPHeaders: bypass ? { "x-vercel-protection-bypass": bypass, "x-vercel-set-bypass-cookie": "true" } : {},
  })
  const api = new FakeApi()
  const answered = await installApiFake(context, origin, api)
  const leaked = trackApiLeaks(context, origin, answered)
  const blocked = await installFuzzGuard(context, origin, { production: cfg.production })
  const data = { seen: 0, answered: answered as Set<unknown> }
  context.on("request", (r) => {
    if (isDataApi(new URL(r.url()), origin)) data.seen += 1
  })
  if (signedIn) {
    await signInContext(context, api, cfg.baseUrl, FUZZ_USER)
    if (state) seedState(api, state)
  }
  if (trace) await context.tracing.start({ screenshots: true, snapshots: true })
  const page = await context.newPage()
  const probe: Probe = { context, page, api, origin, blocked, leaked, data, pageErrors: [], consoleErrors: [], serverErrors: [], harnessInduced: [], fakeAnswered: [] }
  page.on("pageerror", (err) => probe.pageErrors.push(`${err.name}: ${err.message}`))
  page.on("console", (msg) => {
    if (msg.type() !== "error") return
    const url = msg.location()?.url ?? ""
    let parsed: URL | null = null
    try {
      parsed = new URL(url)
    } catch {}
    // Chromium logs every 4xx/5xx load. For /api data that status is the fake's choice
    // (e.g. 404 for a friend profile it was not seeded with), not the server's.
    if (/^Failed to load resource/.test(msg.text()) && parsed && isDataApi(parsed, origin)) {
      probe.fakeAnswered.push(`${msg.text()} (${parsed.pathname})`)
      return
    }
    if (!isAllowlisted(allowlist, { message: msg.text(), url })) {
      probe.consoleErrors.push(parsed && parsed.origin === origin ? `${msg.text()} (at ${parsed.pathname})` : msg.text())
    }
  })
  page.on("response", (res) => {
    const url = new URL(res.url())
    // The fake's own answers (e.g. 503 for an unconfigured planner) are not the server's.
    if (url.origin === origin && !isDataApi(url, origin) && res.status() >= 500) {
      probe.serverErrors.push(`${res.status()} ${res.request().method()} ${url.pathname}`)
    }
  })
  return probe
}

function seedState(api: FakeApi, state: State) {
  api.seed("/api/profile", state.profile)
  if (state.sessions) api.seed("/api/sessions", state.sessions)
  if (state.weights) api.seed("/api/weights", state.weights)
  if (state.exercises) api.seed("/api/exercises", state.exercises)
  if (state.trainingDays) api.seed("/api/training-days", state.trainingDays)
}

// ---------------------------------------------------------------- page probes

/**
 * Runs in the page. Lists what a user could act on right now (inside the topmost open
 * dialog if there is one), in DOM order; with `mark`, tags the matching element with
 * data-fuzz-pick instead and returns whether it was found.
 */
function scan(mark: Target | null): Target[] | boolean {
  const visible = (el: Element) =>
    (el as HTMLElement).checkVisibility
      ? (el as HTMLElement).checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
      : !!((el as HTMLElement).offsetWidth || (el as HTMLElement).offsetHeight)
  document.querySelectorAll("[data-fuzz-pick]").forEach((e) => e.removeAttribute("data-fuzz-pick"))
  const dialogs = [...document.querySelectorAll("dialog[open], [role=dialog], [role=alertdialog]")].filter(
    (d) => visible(d) && !d.closest('[aria-hidden="true"], [inert]') && d.getBoundingClientRect().width > 0,
  )
  const scope: ParentNode = dialogs[dialogs.length - 1] ?? document
  const selector =
    "a[href], button, [role=button], [role=tab], [role=menuitem], [role=switch], [role=checkbox], [role=radio], [role=option], summary, input, textarea, select"
  const out: Target[] = []
  const counts = new Map<string, number>()
  for (const node of scope.querySelectorAll(selector)) {
    const el = node as HTMLElement & { disabled?: boolean; readOnly?: boolean; labels?: NodeListOf<HTMLLabelElement> }
    if (!visible(el) || el.closest('[inert], [aria-hidden="true"]')) continue
    if (el.disabled || el.getAttribute("aria-disabled") === "true") continue
    const rect = el.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) continue
    const tag = el.tagName.toLowerCase()
    const type = (el.getAttribute("type") ?? "").toLowerCase()
    const ariaRole = el.getAttribute("role") ?? ""
    let kind = "click"
    let href: string | undefined
    if (tag === "a") {
      const u = new URL((el as HTMLAnchorElement).href, location.href)
      if (u.origin !== location.origin || (el as HTMLAnchorElement).target === "_blank" || el.hasAttribute("download")) continue
      href = u.pathname
    }
    if (tag === "select") kind = "select"
    else if (tag === "textarea") kind = "fill"
    else if (tag === "input") {
      if (["hidden", "file", "image", "reset", "range", "color"].includes(type)) continue
      if (el.readOnly) continue
      if (type === "checkbox" || type === "radio") kind = "toggle"
      else if (type === "submit" || type === "button") kind = "click"
      else if (["date", "time", "datetime-local", "month", "week"].includes(type)) kind = "fill-date"
      else kind = "fill"
    } else if (["switch", "checkbox", "radio"].includes(ariaRole)) kind = "toggle"
    const label = el.labels && el.labels[0] ? el.labels[0].innerText : ""
    const name = (el.getAttribute("aria-label") || label || el.getAttribute("placeholder") || el.innerText || el.getAttribute("title") || el.getAttribute("name") || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60)
    const role =
      ariaRole ||
      (tag === "a" ? "link" : tag === "button" ? "button" : tag === "select" ? "combobox" : tag === "textarea" ? "textbox" : tag === "input" ? (kind === "toggle" ? type : kind === "click" ? "button" : "textbox") : tag)
    const key = `${kind}|${role}|${name}`
    const nth = counts.get(key) ?? 0
    counts.set(key, nth + 1)
    const target: Target = { kind, role, name, nth, inputType: type || undefined, href }
    if (tag === "select") target.options = (el as unknown as HTMLSelectElement).options.length
    if (mark) {
      if (mark.kind === kind && mark.role === role && mark.name === name && mark.nth === nth) {
        el.setAttribute("data-fuzz-pick", "1")
        return true
      }
      continue
    }
    out.push(target)
  }
  return mark ? false : out
}

/** Runs in the page: the DOM invariants (blank page, bad text, overflow, spinner). */
function domState() {
  const visible = (el: Element) =>
    (el as HTMLElement).checkVisibility
      ? (el as HTMLElement).checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
      : !!((el as HTMLElement).offsetWidth || (el as HTMLElement).offsetHeight)
  const main = document.querySelector("main, [role=main]") as HTMLElement | null
  const text = ((main ?? document.body)?.innerText ?? "").trim()
  const re = /(^|[^A-Za-z0-9_])(NaN|undefined|null|Infinity|\[object Object\]|Invalid Date)(?![A-Za-z0-9_])/
  const bad: { token: string; text: string }[] = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n && bad.length < 5; n = walker.nextNode()) {
    const t = n.nodeValue ?? ""
    const m = re.exec(t)
    if (!m) continue
    const el = n.parentElement
    if (!el || el.closest("script, style, noscript, template, [aria-hidden='true']") || !visible(el)) continue
    bad.push({ token: m[2], text: t.replace(/\s+/g, " ").trim().slice(0, 120) })
  }
  const se = document.scrollingElement ?? document.documentElement
  let widest = ""
  if (se.scrollWidth > window.innerWidth + 1) {
    // Name the first element that sticks out, so the finding says where to look.
    for (const el of document.body.querySelectorAll("*")) {
      const r = el.getBoundingClientRect()
      if (r.right > window.innerWidth + 1 && r.width > 0 && visible(el)) {
        const h = el as HTMLElement
        widest = `${el.tagName.toLowerCase()}${h.id ? `#${h.id}` : ""} "${(h.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 40)}"`
        break
      }
    }
  }
  const spinner = [...document.querySelectorAll('.animate-spin, [aria-busy="true"], [role="progressbar"]:not([aria-valuenow])')].some(visible)
  return { blank: text.length === 0, bad, scrollWidth: se.scrollWidth, innerWidth: window.innerWidth, widest, spinner }
}

// ---------------------------------------------------------------- invariants

type Cursor = { pageErrors: number; consoleErrors: number; serverErrors: number; leaked: number; blocked: number }
const cursorOf = (p: Probe): Cursor => ({
  pageErrors: p.pageErrors.length,
  consoleErrors: p.consoleErrors.length,
  serverErrors: p.serverErrors.length,
  leaked: p.leaked.length,
  blocked: p.blocked.length,
})

/**
 * What a page says when one of its requests fails at the network level. When the guard
 * aborted a request during the same action, such an error is the harness's doing (the
 * app sees a dead network), not a bug; it is counted in `harnessInduced` instead.
 */
const NETWORK_FAILURE = /Failed to fetch|NetworkError|Load failed|ERR_BLOCKED_BY_CLIENT|ERR_FAILED/

async function settle(page: Page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {})
  await page.waitForTimeout(350)
}

async function readDom(page: Page) {
  for (let i = 0; i < 3; i++) {
    try {
      return await page.evaluate(domState)
    } catch {
      // Navigated mid-evaluate: let the new document load and look again.
      await settle(page)
    }
  }
  return null
}

/** Every invariant, for what happened since `since`. Mutates `since` to now. */
async function checkInvariants(p: Probe, since: Cursor): Promise<Violation[]> {
  const out: Violation[] = []
  // apiGuard's leak list fills in once requests settle.
  await p.page.waitForTimeout(50)
  const guardActed = p.blocked.length > since.blocked
  const harness = (msg: string) => guardActed && NETWORK_FAILURE.test(msg) && (p.harnessInduced.push(msg), true)
  for (const e of p.pageErrors.slice(since.pageErrors)) if (!harness(e)) out.push({ kind: "page-error", message: e })
  for (const e of p.consoleErrors.slice(since.consoleErrors)) if (!harness(e)) out.push({ kind: "console-error", message: e })
  for (const e of p.serverErrors.slice(since.serverErrors)) out.push({ kind: "server-5xx", message: e })
  for (const e of p.leaked.slice(since.leaked)) out.push({ kind: "api-leak", message: `data-API request reached the network: ${e}` })
  Object.assign(since, cursorOf(p))

  if (new URL(p.page.url()).origin !== p.origin) return out
  let dom = await readDom(p.page)
  if (!dom) return out
  // Transient states (a page mid-render, a value mid-update) get a second look first.
  if (dom.blank || dom.bad.length || dom.scrollWidth > dom.innerWidth + 1) {
    await p.page.waitForTimeout(dom.blank ? 3000 : 1000)
    dom = (await readDom(p.page)) ?? dom
  }
  if (dom.blank) out.push({ kind: "blank-page", message: "main landmark has no text" })
  for (const b of dom.bad) out.push({ kind: "bad-text", message: `visible "${b.token}" in "${b.text}"` })
  if (dom.scrollWidth > dom.innerWidth + 1) {
    out.push({ kind: "horizontal-overflow", message: `page is ${dom.scrollWidth}px wide at ${dom.innerWidth}px; first overflowing: ${dom.widest || "?"}` })
  }
  if (dom.spinner) {
    const start = Date.now()
    let spinning: boolean = true
    while (spinning && Date.now() - start < SPINNER_LIMIT_MS) {
      await p.page.waitForTimeout(500)
      spinning = (await readDom(p.page))?.spinner ?? false
    }
    if (spinning) out.push({ kind: "stuck-spinner", message: `spinner still visible after ${SPINNER_LIMIT_MS / 1000}s` })
  }
  return out
}

// ---------------------------------------------------------------- actions

function describe(a: Action): string {
  switch (a.type) {
    case "element": {
      const t = a.target
      const what = `${t.role} "${t.name}"${t.nth ? ` (#${t.nth + 1})` : ""}`
      if (t.kind === "fill" || t.kind === "fill-date") return `fill ${what} with ${JSON.stringify(a.value)}${a.submit ? " and press Enter" : ""}`
      if (t.kind === "select") return `choose option ${a.index} in ${what}`
      if (t.kind === "toggle") return `toggle ${what}`
      return `click ${what}${t.href ? ` → ${t.href}` : ""}`
    }
    case "scroll":
      return `scroll ${a.dy > 0 ? "down" : "up"} ${Math.abs(a.dy)}px`
    case "goto":
      return `open ${a.path}${a.why ? ` (${a.why})` : ""}`
    case "escape":
      return "press Escape"
    default:
      return `browser ${a.type}`
  }
}

async function chooseAction(page: Page, rng: ReturnType<typeof createRng>): Promise<Action> {
  const kind = rng.weighted([
    ["element", 80],
    ["escape", 5],
    ["scroll", 5],
    ["back", 4],
    ["forward", 2],
    ["reload", 3],
  ] as [string, number][])
  if (kind === "element") {
    const candidates = ((await page.evaluate(scan, null).catch(() => [])) as Target[]) ?? []
    if (candidates.length) {
      const target = rng.pick(candidates)
      if (target.kind === "fill") return { type: "element", target, value: rng.pick([...EDGE_INPUTS]), submit: rng.chance(0.25) }
      if (target.kind === "fill-date") return { type: "element", target, value: rng.pick(["", "0001-01-01", "1970-01-01", "2099-12-31", "9999-12-31"]) }
      if (target.kind === "select") return { type: "element", target, index: rng.int(0, Math.max(0, (target.options ?? 1) - 1)) }
      return { type: "element", target }
    }
    return { type: "escape" }
  }
  if (kind === "scroll") return { type: "scroll", dy: rng.pick([-600, -300, 300, 600, 1200]) }
  return { type: kind as "escape" | "back" | "forward" | "reload" }
}

/** Do `a`. Returns a note when it had no effect (target gone, click intercepted, ...). */
async function perform(page: Page, a: Action): Promise<string | null> {
  try {
    switch (a.type) {
      case "element": {
        const found = await page.evaluate(scan, a.target)
        if (!found) return "target not on the page"
        const loc = page.locator("[data-fuzz-pick]").first()
        const t = a.target
        if (t.kind === "fill" || t.kind === "fill-date") {
          await loc.fill(a.value ?? "", { timeout: 3000 })
          if (a.submit) await loc.press("Enter", { timeout: 3000 })
        } else if (t.kind === "select") await loc.selectOption({ index: a.index ?? 0 }, { timeout: 3000 })
        else await loc.click({ timeout: 3000 })
        break
      }
      case "escape":
        await page.keyboard.press("Escape")
        break
      case "scroll":
        await page.mouse.wheel(0, a.dy)
        break
      case "back":
        await page.goBack({ waitUntil: "domcontentloaded", timeout: 15_000 })
        break
      case "forward":
        await page.goForward({ waitUntil: "domcontentloaded", timeout: 15_000 })
        break
      case "reload":
        await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 })
        break
      case "goto":
        await page.goto(a.path, { waitUntil: "domcontentloaded", timeout: 30_000 })
        break
    }
    return null
  } catch (e) {
    return `no effect: ${String((e as Error).message ?? e).split("\n")[0].slice(0, 100)}`
  } finally {
    await page.evaluate(() => document.querySelectorAll("[data-fuzz-pick]").forEach((e) => e.removeAttribute("data-fuzz-pick"))).catch(() => {})
    await settle(page)
  }
}

// ---------------------------------------------------------------- monkey

function preamble(t: MonkeyTarget, state: State | null): string {
  return t.signedIn
    ? `fresh browser context at 393×852, signed in as ${FUZZ_USER.name} <${FUZZ_USER.email}>; account: ${state?.summary}`
    : "fresh browser context at 393×852, signed out"
}

/** Replay `actions` from the same state in a fresh context; returns the signatures seen. */
async function replay(browser: Browser, cfg: RunConfig, t: MonkeyTarget, state: State | null, actions: Action[], want: Set<string>): Promise<Set<string>> {
  const seen = new Set<string>()
  const p = await openProbe(browser, cfg, { signedIn: t.signedIn, state })
  try {
    const since = cursorOf(p)
    const record = (vs: Violation[]) => {
      for (const v of vs) seen.add(findingSignature({ kind: v.kind, route: p.page.url(), message: v.message }))
    }
    await perform(p.page, { type: "goto", path: t.route, why: "" })
    record(await checkInvariants(p, since))
    for (const a of actions) {
      if ([...want].every((s) => seen.has(s))) break
      await perform(p.page, a)
      record(await checkInvariants(p, since))
    }
  } finally {
    await p.context.close().catch(() => {})
  }
  return seen
}

export async function runMonkey(browser: Browser, cfg: RunConfig, t: MonkeyTarget, budgetMs: number): Promise<MonkeyResult> {
  const rng = createRng(hashSeed(cfg.seed, t.id))
  const state = t.signedIn ? generateState(rng.fork("state"), FUZZ_USER) : null
  const actRng = rng.fork("actions")
  const dir = path.join(cfg.out, "monkeys", t.id.replace(/[^\w-]+/g, "_"))
  fs.mkdirSync(dir, { recursive: true })
  const result: MonkeyResult = {
    id: t.id,
    feature: t.feature,
    signedIn: t.signedIn,
    status: "passed",
    actions: 0,
    state: state?.summary,
    findings: [],
    blocked: [],
    dataRequests: { seen: 0, answered: 0 },
    apiLeaks: [],
  }
  const endBy = Date.now() + budgetMs
  const trace = cfg.trace && !cfg.production
  const p = await openProbe(browser, cfg, { signedIn: t.signedIn, state, trace })
  const actions: Action[] = []
  const steps = [preamble(t, state)]
  const since = cursorOf(p)
  try {
    let pending: Action | null = { type: "goto", path: t.route, why: "entry route" }
    while (pending) {
      const a: Action = pending
      pending = null
      const note = await perform(p.page, a)
      // The entry route is the setup, not a fuzz action; everything after it counts.
      if (actions.length > 0) result.actions += 1
      actions.push(a)
      steps.push(`${describe(a)}${note ? ` [${note}]` : ""}`)
      const violations = await checkInvariants(p, since)
      if (violations.length) {
        result.findings = await recordFindings(browser, cfg, t, state, p, actions, steps, violations, dir, trace)
        result.status = "failed"
        break
      }
      if (result.actions >= cfg.maxActions || Date.now() > endBy) break
      // A blocked cross-origin navigation leaves the tab on the browser's error page.
      if (new URL(p.page.url()).origin !== p.origin) pending = { type: "goto", path: t.route, why: `left the app for ${p.page.url().slice(0, 60)}` }
      else pending = await chooseAction(p.page, actRng)
    }
  } finally {
    if (trace && result.status !== "failed") await p.context.tracing.stop().catch(() => {})
    result.blocked = p.blocked
    result.apiLeaks = p.leaked
    result.harnessInduced = [...p.harnessInduced, ...p.fakeAnswered]
    result.dataRequests = { seen: p.data.seen, answered: p.data.answered.size }
    await p.context.close().catch(() => {})
    // The whole action log, finding or not: what this monkey did, replayable by seed.
    fs.writeFileSync(path.join(dir, "steps.txt"), steps.map((s, i) => `${i + 1}. ${s}`).join("\n") + "\n")
  }
  return result
}

async function recordFindings(
  browser: Browser,
  cfg: RunConfig,
  t: MonkeyTarget,
  state: State | null,
  p: Probe,
  actions: Action[],
  steps: string[],
  violations: Violation[],
  dir: string,
  trace: boolean,
): Promise<Finding[]> {
  const route = routePattern(p.page.url())
  const sigs = violations.map((v) => findingSignature({ kind: v.kind, route: p.page.url(), message: v.message }))
  const screenshot = path.join(dir, `finding-${sigs[0]}.png`)
  await p.page.screenshot({ path: screenshot }).catch(() => {})
  let tracePath: string | undefined
  if (trace) {
    tracePath = path.join(dir, `trace-${sigs[0]}.zip`)
    await p.context.tracing.stop({ path: tracePath }).catch(() => (tracePath = undefined))
  }
  const seen = await replay(browser, cfg, t, state, actions, new Set(sigs))
  return violations.map((v, i) => ({
    signature: sigs[i],
    kind: v.kind,
    feature: t.feature,
    route,
    message: v.message,
    reproducible: seen.has(sigs[i]),
    steps: [...steps, `observe: ${v.kind}: ${v.message}`],
    screenshot: path.relative(cfg.out, screenshot),
    ...(tracePath ? { trace: path.relative(cfg.out, tracePath) } : {}),
  }))
}
