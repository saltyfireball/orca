// Best of N (FORK.md, SLRM-2393): one task sent to 2 to 4 agents, each in its own new worktree,
// compared side by side and settled by picking a winner. This file holds the plain rules shared by
// the CLI that starts a run, main that keeps it and the window that compares and picks.

export const FORK_BEST_OF_MIN_ATTEMPTS = 2
export const FORK_BEST_OF_MAX_ATTEMPTS = 4
export const FORK_BEST_OF_HISTORY_DEFAULT = 20
export const FORK_BEST_OF_HISTORY_MAX = 100
export const FORK_BEST_OF_PROMPT_MAX = 20_000
export const FORK_BEST_OF_NOTE_MAX = 4000

export const FORK_BEST_OF_LOSER_ACTIONS = ['archive', 'remove', 'keep'] as const
/** What a pick does with the attempts that lost: archive keeps the branch and the row. */
export type ForkBestOfLoserAction = (typeof FORK_BEST_OF_LOSER_ACTIONS)[number]

/** Placement of an attempt: auto placement, this machine, or a paired server's name or id. */
export const FORK_BEST_OF_AUTO = 'auto'
export const FORK_BEST_OF_HERE = 'here'

export const FORK_BEST_OF_DEFAULT_NOTE = [
  'You are attempt {{index}} of {{count}} in a best-of-{{count}} run: other agents work on the same task in their own worktrees, and the user keeps one result.',
  'Do the task in this worktree only. Run the tests and checks that apply, then commit your work on this branch (do not push).',
  'End your report with these two lines, so the compare view can read them:',
  'Tests: pass, fail or not run',
  'Checks: pass, fail or not run'
].join('\n')

export type ForkBestOfSettings = {
  enabled: boolean
  /** Default agents for attempts, `agent[:model[:effort]]` comma separated; cycled over attempts. */
  agents: string
  /** Default placement for attempts, comma separated; cycled over attempts. */
  placement: string
  loserAction: ForkBestOfLoserAction
  history: number
  /** Appended to each attempt's prompt; {{index}} and {{count}} are filled in. */
  attemptNote: string
}

function field(settings: unknown, key: string): unknown {
  return settings && typeof settings === 'object'
    ? (settings as Record<string, unknown>)[key]
    : undefined
}

function text(value: unknown, fallback: string, max: number): string {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim().slice(0, max)
    : fallback
}

export function isForkBestOfLoserAction(value: unknown): value is ForkBestOfLoserAction {
  return (FORK_BEST_OF_LOSER_ACTIONS as readonly unknown[]).includes(value)
}

export function readForkBestOfSettings(settings: unknown): ForkBestOfSettings {
  const action = field(settings, 'forkBestOfLoserAction')
  const history = field(settings, 'forkBestOfHistory')
  return {
    enabled: field(settings, 'forkBestOf') !== false,
    agents: text(field(settings, 'forkBestOfAgents'), 'claude', 512),
    placement: text(field(settings, 'forkBestOfPlacement'), FORK_BEST_OF_AUTO, 512),
    loserAction: isForkBestOfLoserAction(action) ? action : 'archive',
    history:
      typeof history === 'number' && Number.isInteger(history) && history >= 1
        ? Math.min(history, FORK_BEST_OF_HISTORY_MAX)
        : FORK_BEST_OF_HISTORY_DEFAULT,
    attemptNote: text(
      field(settings, 'forkBestOfAttemptNote'),
      FORK_BEST_OF_DEFAULT_NOTE,
      FORK_BEST_OF_NOTE_MAX
    )
  }
}

export type ForkBestOfAgentChoice = { agent: string; model?: string; effort?: string }

const AGENT_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i
// Model ids are opaque to Orca (provider/model, @role, model:level); only shell-safe text passes.
const MODEL_ID = /^[\w.@/:[\]-]{1,200}$/
const EFFORTS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

/** `claude,codex:gpt-5:high,claude:opus` as agent choices; throws on a malformed entry. */
export function parseForkBestOfAgents(value: string): ForkBestOfAgentChoice[] {
  const choices = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry): ForkBestOfAgentChoice => {
      const colon = entry.indexOf(':')
      const agent = colon === -1 ? entry : entry.slice(0, colon)
      let model = colon === -1 ? '' : entry.slice(colon + 1)
      let effort: string | undefined
      const last = model.lastIndexOf(':')
      if (last !== -1 && EFFORTS.has(model.slice(last + 1).toLowerCase())) {
        effort = model.slice(last + 1).toLowerCase()
        model = model.slice(0, last)
      }
      if (!AGENT_ID.test(agent)) {
        throw new Error(`"${entry}" does not name an agent (agent[:model[:effort]]).`)
      }
      if (model && !MODEL_ID.test(model)) {
        throw new Error(`"${entry}" has a model id with characters Orca does not pass on.`)
      }
      if (effort && !model) {
        throw new Error(`"${entry}" sets an effort without a model.`)
      }
      return { agent, ...(model ? { model } : {}), ...(effort ? { effort } : {}) }
    })
  if (choices.length === 0) {
    throw new Error('Name at least one agent.')
  }
  if (choices.length > FORK_BEST_OF_MAX_ATTEMPTS) {
    throw new Error(`At most ${FORK_BEST_OF_MAX_ATTEMPTS} agents.`)
  }
  return choices
}

const HOST = /^[\w.:@-]{1,256}$/

/** `auto`, `here` or server names, comma separated; throws on a malformed entry. */
export function parseForkBestOfHosts(value: string): string[] {
  const hosts = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  for (const host of hosts) {
    if (!HOST.test(host)) {
      throw new Error(`"${host}" is not auto, here or a server name.`)
    }
  }
  if (hosts.length === 0) {
    throw new Error('Name at least one machine, or auto.')
  }
  if (hosts.length > FORK_BEST_OF_MAX_ATTEMPTS) {
    throw new Error(`At most ${FORK_BEST_OF_MAX_ATTEMPTS} machines.`)
  }
  return hosts
}

/** Choice i of n, cycling a shorter list. */
export function forkBestOfCycle<T>(list: readonly T[], index: number): T {
  return list[index % list.length]
}

export function checkForkBestOfCount(count: number): void {
  if (
    !Number.isInteger(count) ||
    count < FORK_BEST_OF_MIN_ATTEMPTS ||
    count > FORK_BEST_OF_MAX_ATTEMPTS
  ) {
    throw new Error(
      `Best of N takes ${FORK_BEST_OF_MIN_ATTEMPTS} to ${FORK_BEST_OF_MAX_ATTEMPTS} attempts.`
    )
  }
}

/** The task each attempt gets: the prompt, then the attempt note with its number filled in. */
export function buildForkBestOfSpec(
  prompt: string,
  note: string,
  index: number,
  count: number
): string {
  const filled = note
    .replaceAll('{{index}}', String(index))
    .replaceAll('{{count}}', String(count))
    .trim()
  return filled ? `${prompt.trim()}\n\n---\n${filled}` : prompt.trim()
}

/** First line of the prompt, as the run's title. */
export function forkBestOfTitle(prompt: string): string {
  const line =
    prompt
      .split('\n')
      .map((entry) => entry.trim())
      .find((entry) => entry.length > 0) ?? ''
  return line.length > 80 ? `${line.slice(0, 77)}...` : line
}

export type ForkBestOfCheckState = 'pass' | 'fail' | 'not-run' | 'unknown'
export type ForkBestOfChecks = { tests: ForkBestOfCheckState; checks: ForkBestOfCheckState }

function checkState(word: string): ForkBestOfCheckState {
  const value = word.toLowerCase()
  if (/^(pass|passed|passing|ok|green)\b/.test(value)) {
    return 'pass'
  }
  if (/^(fail|failed|failing|red|error)\b/.test(value)) {
    return 'fail'
  }
  return /^(not run|none|skipped|n\/a)\b/.test(value) ? 'not-run' : 'unknown'
}

/** The `Tests:` and `Checks:` lines of an attempt's report; the last of each wins. */
export function parseForkBestOfChecks(report: string | null | undefined): ForkBestOfChecks {
  const result: ForkBestOfChecks = { tests: 'unknown', checks: 'unknown' }
  for (const line of (report ?? '').split('\n')) {
    const match = /^\s*[-*]?\s*\**(tests|checks)\**\s*:\s*\**\s*(.+)$/i.exec(line)
    if (match) {
      result[match[1].toLowerCase() as keyof ForkBestOfChecks] = checkState(match[2].trim())
    }
  }
  return result
}

export type ForkBestOfAttemptOutcome = {
  kind: 'kept' | 'archived' | 'removed' | 'left' | 'failed'
  message?: string
}

/** One attempt as the CLI started it. Placement is what was asked; facts come from main. */
export type ForkBestOfAttempt = {
  index: number
  agent: string
  model?: string
  effort?: string
  /** `here`, or the paired server the attempt was started on (as passed to --on). */
  host: string
  dispatchId?: string
  taskId?: string
  runId?: string
  startError?: string
  outcome?: ForkBestOfAttemptOutcome
}

export type ForkBestOfRun = {
  id: string
  createdAt: number
  title: string
  prompt: string
  repo?: string
  baseBranch?: string
  attempts: ForkBestOfAttempt[]
  winner?: number
  pickedAt?: number
  loserAction?: ForkBestOfLoserAction
}

export function forkBestOfAgentLabel(
  attempt: Pick<ForkBestOfAttempt, 'agent' | 'model' | 'effort'>
): string {
  return [attempt.agent, attempt.model, attempt.effort].filter(Boolean).join(' ')
}

/** Attempt k of a run, or an error naming the valid numbers. */
export function findForkBestOfAttempt(run: ForkBestOfRun, index: number): ForkBestOfAttempt {
  const attempt = run.attempts.find((entry) => entry.index === index)
  if (!attempt) {
    throw new Error(`Attempt ${index} is not in this run (1 to ${run.attempts.length}).`)
  }
  return attempt
}

/** A run by id or unique prefix of 4+ characters. */
export function findForkBestOfRun(runs: readonly ForkBestOfRun[], query: string): ForkBestOfRun {
  const exact = runs.find((run) => run.id === query)
  if (exact) {
    return exact
  }
  const matches = query.length >= 4 ? runs.filter((run) => run.id.startsWith(query)) : []
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `No best-of run matches "${query}". Run "orca best-of list" for ids.`
        : `"${query}" matches more than one run; use more of its id.`
    )
  }
  return matches[0]
}
