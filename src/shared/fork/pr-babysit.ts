// PR babysitter (FORK.md, SLRM-2386): its settings, the per-PR record and the pure rules of what a
// CI result line does. Stock Orca's PR watcher reads the checks and writes "CI failing" / "CI green"
// into the chat that opened or pushed to the PR; the babysitter acts on that line: it sends the
// chat one fix request per failure, up to a cap, and on green may merge (a separate setting).
// Everything here is pure, so the host service, the CLI and the window share it.
export type ForkPrBabysitMergeMethod = 'repo' | 'squash' | 'merge' | 'rebase'

export type ForkPrBabysitSettings = {
  /** Fork PR babysitter (SLRM-2386): owner/repo names whose pull requests are babysat, "*" for every repo; unset is none (off). */
  forkPrBabysitRepos?: string[]
  /** Fork PR babysitter: fix requests sent for one pull request before it stops and asks you (1 to 10); unset is 3. */
  forkPrBabysitMaxRounds?: number
  /** Fork PR babysitter: minutes to wait for a new CI result after a fix request before it stops and asks you; unset is 120. */
  forkPrBabysitWaitMinutes?: number
  /** Fork PR babysitter: merge a babysat pull request once every check is green, no change is requested and GitHub reports it mergeable. Off unless true. */
  forkPrBabysitAutoMerge?: boolean
  /** Fork PR babysitter: 'repo' uses the repository's default merge method; unset is 'repo'. */
  forkPrBabysitMergeMethod?: ForkPrBabysitMergeMethod
}

export const PR_BABYSIT_DEFAULT_MAX_ROUNDS = 3
export const PR_BABYSIT_DEFAULT_WAIT_MINUTES = 120
const MAX_REPOS = 200
const MAX_REPO_CHARS = 300

export type PrBabysitSettings = {
  repos: string[]
  maxRounds: number
  waitMinutes: number
  autoMerge: boolean
  mergeMethod: ForkPrBabysitMergeMethod
}

type SettingKey = keyof ForkPrBabysitSettings
export type PrBabysitSettingsSource =
  | Partial<Record<SettingKey, unknown>>
  | ForkPrBabysitSettings
  | null
  | undefined

function whole(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback
}

/** Lower-case `owner/repo`, `host/owner/repo` or `*`; anything else is dropped. */
export function normalizePrBabysitRepo(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const text = value.trim().toLowerCase()
  if (text === '*') {
    return text
  }
  return text.length <= MAX_REPO_CHARS &&
    /^([a-z0-9][a-z0-9.-]*\/)?\w[\w.-]*\/\w[\w.-]*$/u.test(text)
    ? text
    : null
}

export function readPrBabysitSettings(source: PrBabysitSettingsSource): PrBabysitSettings {
  const s = (source ?? {}) as Partial<Record<SettingKey, unknown>>
  const repos = Array.isArray(s.forkPrBabysitRepos)
    ? [
        ...new Set(
          s.forkPrBabysitRepos
            .map(normalizePrBabysitRepo)
            .filter((repo): repo is string => repo !== null)
        )
      ].slice(0, MAX_REPOS)
    : []
  const method = s.forkPrBabysitMergeMethod
  return {
    repos,
    maxRounds: whole(s.forkPrBabysitMaxRounds, 1, 10, PR_BABYSIT_DEFAULT_MAX_ROUNDS),
    waitMinutes: whole(s.forkPrBabysitWaitMinutes, 10, 1440, PR_BABYSIT_DEFAULT_WAIT_MINUTES),
    autoMerge: s.forkPrBabysitAutoMerge === true,
    mergeMethod: method === 'squash' || method === 'merge' || method === 'rebase' ? method : 'repo'
  }
}

/** A pull request as stock Orca keys it: `host/owner/repo#number`, lower case. */
export type PrBabysitPr = { host: string; owner: string; repo: string; number: number }

export function prBabysitKey(pr: PrBabysitPr): string {
  return `${pr.host}/${pr.owner}/${pr.repo}#${pr.number}`.toLowerCase()
}

// No part may start with '-' or '.', so none can be read as a gh flag.
const KEY = /^([a-z0-9][a-z0-9.-]*)\/(\w[\w.-]*)\/(\w[\w.-]*)#(\d{1,9})$/u

export function parsePrBabysitKey(prKey: string): PrBabysitPr | null {
  const match = KEY.exec(prKey.toLowerCase())
  return match
    ? { host: match[1]!, owner: match[2]!, repo: match[3]!, number: Number(match[4]) }
    : null
}

/**
 * What a user types: a pull request URL, `owner/repo#12` or `host/owner/repo#12`. A bare owner and
 * repo means github.com. Null for anything else.
 */
export function parsePrBabysitTarget(input: string): PrBabysitPr | null {
  const text = input.trim()
  const url = /^https:\/\/([a-z0-9.-]+)\/([\w.-]+)\/([\w.-]+)\/pull\/(\d{1,9})(?:[/?#].*)?$/iu.exec(
    text
  )
  if (url) {
    return parsePrBabysitKey(`${url[1]}/${url[2]}/${url[3]}#${url[4]}`)
  }
  return parsePrBabysitKey(text) ?? parsePrBabysitKey(`github.com/${text}`)
}

/** True when the Settings repo list names this pull request's repository. */
export function prBabysitRepoListed(prKey: string, repos: readonly string[]): boolean {
  const pr = parsePrBabysitKey(prKey)
  if (!pr) {
    return false
  }
  const slug = `${pr.owner}/${pr.repo}`
  return repos.some((repo) => repo === '*' || repo === slug || repo === `${pr.host}/${slug}`)
}

/**
 * - watching: babysat, nothing sent yet (or handed back after green or your answer).
 * - fixing: a fix request went to the chat; waiting for the next CI result.
 * - green: the last result was green (and, with auto-merge, why it did not merge if it did not).
 * - merged: the babysitter merged it.
 * - stuck: it stopped and put the pull request in the Decision inbox.
 * - stopped: you turned it off for this pull request.
 */
export type PrBabysitPhase = 'watching' | 'fixing' | 'green' | 'merged' | 'stuck' | 'stopped'

/** Why it stopped or did not merge; the window words each, `detail` adds GitHub's own text. */
export type PrBabysitReason =
  | 'cap'
  | 'no-ci'
  | 'chat-unavailable'
  | 'no-chat'
  | 'merge-blocked'
  | 'merge-failed'

export type PrBabysitEntry = {
  prKey: string
  /** 'cli': `orca babysit`; 'repo': the repo list in Settings. */
  source: 'cli' | 'repo'
  /** The chat the fix requests go to: one that opened or pushed to the PR. */
  chatId: string | null
  rounds: number
  phase: PrBabysitPhase
  reason: PrBabysitReason | null
  /** GitHub's own words for a block or a failed merge, short and without control characters. */
  detail: string
  /** `headSha:occurrence` of the last CI line acted on, so a line is never acted on twice. */
  lastEvent: string | null
  headSha: string | null
  fixSentAt: number | null
  stuckSince: number | null
  updatedAt: number
}

export type PrBabysitLine = {
  prKey: string
  headSha: string
  occurrence: number
  verdict: 'failure' | 'success'
}

export type PrBabysitStep =
  | { kind: 'ignore' }
  | { kind: 'fix'; round: number }
  | { kind: 'stuck'; reason: 'cap' }
  | { kind: 'green'; merge: boolean }

export function prBabysitEventId(line: Pick<PrBabysitLine, 'headSha' | 'occurrence'>): string {
  return `${line.headSha.toLowerCase()}:${line.occurrence}`
}

/** What one CI line does to a babysat pull request. */
export function decidePrBabysitStep(
  entry: Pick<PrBabysitEntry, 'phase' | 'rounds' | 'lastEvent'>,
  line: PrBabysitLine,
  settings: Pick<PrBabysitSettings, 'maxRounds' | 'autoMerge'>
): PrBabysitStep {
  if (entry.phase === 'stopped' || entry.phase === 'merged') {
    return { kind: 'ignore' }
  }
  if (entry.lastEvent === prBabysitEventId(line)) {
    return { kind: 'ignore' }
  }
  if (line.verdict === 'success') {
    return { kind: 'green', merge: settings.autoMerge }
  }
  // Stuck waits for you; only a green result (someone fixed it) moves it on by itself.
  if (entry.phase === 'stuck') {
    return { kind: 'ignore' }
  }
  if (entry.rounds >= settings.maxRounds) {
    return { kind: 'stuck', reason: 'cap' }
  }
  return { kind: 'fix', round: entry.rounds + 1 }
}

/** A fix request sent this long ago with no CI result since: it stops and asks you. */
export function prBabysitOverdue(
  entry: Pick<PrBabysitEntry, 'phase' | 'fixSentAt'>,
  nowMs: number,
  settings: Pick<PrBabysitSettings, 'waitMinutes'>
): boolean {
  return (
    entry.phase === 'fixing' &&
    entry.fixSentAt !== null &&
    nowMs - entry.fixSentAt >= settings.waitMinutes * 60_000
  )
}

/** What GitHub says about a pull request, as far as merging goes. */
export type PrBabysitPrFacts = {
  state: string
  isDraft: boolean
  headSha: string
  reviewDecision: string | null
  mergeable: string | null
  mergeStateStatus: string | null
  /** One per check run or status: true only when it finished green (success, neutral, skipped). */
  checksGreen: boolean[]
}

/**
 * Null when the pull request may be merged now, else GitHub's reason in a few words. Every check
 * (required or not) must be green on the head the green line was for, no change requested, no
 * review still required, and GitHub must call the merge clean. Branch protection is enforced
 * again by GitHub itself when gh merges, since nothing here asks to bypass it.
 */
export function prBabysitMergeBlock(facts: PrBabysitPrFacts, headSha: string): string | null {
  if (facts.state.toUpperCase() !== 'OPEN') {
    return `the pull request is ${facts.state.toLowerCase()}`
  }
  if (facts.isDraft) {
    return 'the pull request is a draft'
  }
  if (facts.headSha.toLowerCase() !== headSha.toLowerCase()) {
    return 'a newer commit was pushed'
  }
  if (facts.reviewDecision === 'CHANGES_REQUESTED') {
    return 'changes are requested'
  }
  if (facts.reviewDecision === 'REVIEW_REQUIRED') {
    return 'a review is required'
  }
  if (facts.checksGreen.length === 0 || facts.checksGreen.some((green) => !green)) {
    return 'not every check is green'
  }
  if (facts.mergeable !== 'MERGEABLE') {
    return `GitHub says the merge is ${(facts.mergeable ?? 'unknown').toLowerCase()}`
  }
  if (facts.mergeStateStatus !== 'CLEAN' && facts.mergeStateStatus !== 'HAS_HOOKS') {
    return `GitHub says the merge state is ${(facts.mergeStateStatus ?? 'unknown').toLowerCase()}`
  }
  return null
}

// Control, bidi and invisible characters never reach a status line, the inbox or a prompt.
const UNSAFE = /[\p{Cc}\p{Cf}\u2028\u2029]/gu

/** One short line of outside text: no control or invisible characters, at most `max` long. */
export function prBabysitPlain(text: string, max = 300): string {
  const flat = text.replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat
}

/** The English status line `orca babysit list` prints; the window words the same states itself. */
export function prBabysitStatusText(entry: PrBabysitEntry, maxRounds: number): string {
  const detail = entry.detail ? `: ${entry.detail}` : ''
  switch (entry.phase) {
    case 'watching':
      return 'watching CI'
    case 'fixing':
      return `fix ${entry.rounds} of ${maxRounds} sent, waiting for CI`
    case 'green':
      return entry.reason
        ? `checks green, not merged (${prBabysitReasonText(entry)})`
        : 'checks green'
    case 'merged':
      return 'merged'
    case 'stopped':
      return 'off for this pull request'
    case 'stuck':
      return `stopped${entry.reason ? `, ${prBabysitReasonText(entry)}` : detail}; see the Decision inbox`
  }
}

export function prBabysitReasonText(
  entry: Pick<PrBabysitEntry, 'reason' | 'detail' | 'rounds'>
): string {
  const detail = entry.detail ? `: ${entry.detail}` : ''
  switch (entry.reason) {
    case 'cap':
      return `CI still failing after ${entry.rounds} fix requests`
    case 'no-ci':
      return 'no new CI result after the last fix request'
    case 'chat-unavailable':
      return 'its chat could not take a message'
    case 'no-chat':
      return 'no chat that opened or pushed to it is on this host'
    case 'merge-blocked':
      return `not mergeable${detail}`
    case 'merge-failed':
      return `merge failed${detail}`
    case null:
      return entry.detail
  }
}
