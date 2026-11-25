// Report helpers: allowlist and known-issue files, secret redaction and summary.md.
// No import.meta here: Playwright's loader compiles this file to CommonJS for monkey.ts,
// so callers pass the file paths (fuzz/allowlist.json, fuzz/known-issues.json).
import fs from "node:fs"

/** fuzz/allowlist.json: [{ message: regex, url?: regex, reason }] for known console noise. */
export function loadAllowlist(file) {
  const entries = JSON.parse(fs.readFileSync(file, "utf8"))
  return entries.map((e) => {
    if (!e.reason) throw new Error(`allowlist entry ${JSON.stringify(e)} has no reason`)
    return { ...e, messageRe: new RegExp(e.message), urlRe: e.url ? new RegExp(e.url) : null }
  })
}

export function isAllowlisted(allowlist, { message, url = "" }) {
  return allowlist.some((e) => e.messageRe.test(message) && (!e.urlRe || e.urlRe.test(url)))
}

/** fuzz/known-issues.json: { "<signature>": "<GitHub issue URL>" }. */
export function loadKnownIssues(file) {
  const map = JSON.parse(fs.readFileSync(file, "utf8"))
  for (const [sig, url] of Object.entries(map)) {
    if (!/^[0-9a-f]{12}$/.test(sig)) throw new Error(`known-issues.json: "${sig}" is not a 12-hex finding signature`)
    if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+$/.test(url)) throw new Error(`known-issues.json: ${sig} → "${url}" is not a GitHub issue URL`)
  }
  return map
}

/**
 * Replace every secret value (and anything that looks like a session JWT) in `text`.
 * `secrets` maps a name to its value; empty values are ignored.
 */
export function redact(text, secrets = {}) {
  let out = String(text)
  for (const [name, value] of Object.entries(secrets)) {
    if (!value || value.length < 6) continue
    for (const form of new Set([value, encodeURIComponent(value), Buffer.from(value).toString("base64")])) {
      out = out.split(form).join(`[REDACTED:${name}]`)
    }
  }
  return out
    .replace(/eyJ[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]*){1,4}/g, "[REDACTED:jwt]")
    .replace(/((?:__Secure-)?authjs\.session-token(?:\.\d+)?=)[^;\s"]+/g, "$1[REDACTED:cookie]")
    .replace(/(x-vercel-protection-bypass["']?\s*[:=]\s*["']?)[^"'\s&,}]+/gi, "$1[REDACTED:header]")
}

const md = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ")

/** One screen of markdown: target, seed, phases, counts, and each finding with repro steps. */
export function renderSummary(report) {
  const fresh = report.findings.filter((f) => !f.known)
  const known = report.findings.filter((f) => f.known)
  const blocked = Object.entries(report.blockedRequests).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(", ") || "none"
  const journeys = report.journeys
  const jPassed = journeys.filter((j) => j.status === "passed").length
  const lines = [
    "# verify-workout fuzz",
    "",
    `- Target: ${report.target}${report.production ? " (**production**, read-only)" : ""}`,
    `- Seed: \`${report.seed}\` · started ${report.startedAt} · ${(report.durationMs / 1000).toFixed(0)} s`,
    `- Replay: \`node .claude/skills/verify-workout/fuzz/fuzz.mjs run --seed ${report.seed}${report.options}\``,
    `- Phases: ${report.phases.map((p) => `${p.name} **${p.status}**${p.skippedReason ? ` (${p.skippedReason})` : ""}`).join(" · ")}`,
    `- Journeys: ${journeys.length ? `${jPassed}/${journeys.length} passed` : "none run"}${journeys.some((j) => j.status !== "passed") ? ` (not passed: ${journeys.filter((j) => j.status !== "passed").map((j) => `${j.feature} ${j.status}`).join(", ")})` : ""}`,
    `- Monkeys: ${report.monkeys.length} run, ${report.actions} actions${report.monkeys.some((m) => m.status === "skipped") ? ` (${report.monkeys.filter((m) => m.status === "skipped").length} skipped: time budget)` : ""}`,
    `- Blocked requests (never sent): ${blocked}`,
    `- Unanswered /api data requests: ${report.apiLeaks + (report.unansweredDataRequests ?? 0)}${report.harnessInduced ? ` · errors caused by the harness (blocked requests, fake-answered statuses; not findings): ${report.harnessInduced}` : ""}`,
    `- Findings: ${new Set(fresh.map((f) => f.signature)).size} new, ${new Set(known.map((f) => f.signature)).size} known (distinct signatures; ${report.findings.length} occurrences)`,
    "",
  ]
  if (!report.findings.length) lines.push("No findings.", "")
  // One entry per signature: the shortest reproduction, plus where else it showed up.
  const bySig = new Map()
  for (const f of [...fresh, ...known]) {
    const group = bySig.get(f.signature)
    if (!group) bySig.set(f.signature, { best: f, all: [f] })
    else {
      group.all.push(f)
      if (f.steps.length < group.best.steps.length) group.best = f
    }
  }
  for (const { best: f, all } of bySig.values()) {
    const others = [...new Set(all.filter((x) => x !== f).map((x) => x.feature))]
    lines.push(
      `### ${f.known ? "known" : "NEW"} \`${f.signature}\` ${f.kind} on \`${f.route}\` (${f.feature})`,
      "",
      `${md(f.message).slice(0, 400)}`,
      "",
      `Reproducible: ${all.map((x) => x.reproducible).every(Boolean) ? "true" : all.some((x) => x.reproducible) ? "sometimes" : "false"}${f.known ? ` · issue: ${f.known}` : ""} · screenshot: \`${f.screenshot ?? "-"}\`${f.trace ? ` · trace: \`${f.trace}\`` : ""}`,
      ...(others.length ? ["", `Also found from: ${others.join(", ")} (${all.length} occurrences in fuzz-report.json)`] : []),
      "",
      ...f.steps.map((s, i) => `${i + 1}. ${md(s)}`),
      "",
    )
  }
  return lines.join("\n")
}
