// Agent guards (FORK.md, SLRM-2385): two guards for agents nobody is watching. The failure-loop
// guard sees the same failing tool call over and over, tells the agent once to change approach and
// pauses it if the call fails again. The spend cap reads the usage ledger's estimate of what a chat
// has spent and pauses it at the turn boundary past its cap. This file holds the settings, the
// loop rule and the entries the status line, the Decision inbox and `orca guards` show. Pure: the
// main process feeds it tool calls and spend. Idea from the archived ccdeck failure-loop and
// spend guards and Devin's per-session limits; only the ideas are ported.

/** Repeats of one failing call before the warning. */
export const AGENT_GUARD_DEFAULT_REPEATS = 6
export const AGENT_GUARD_MIN_REPEATS = 3
export const AGENT_GUARD_MAX_REPEATS = 50
export const AGENT_GUARD_MAX_CAP_USD = 10_000

export type AgentGuardSpendScope = 'workers' | 'all'

export type ForkAgentGuardSettings = {
  /** Fork (SLRM-2385): warn, then pause, an agent that repeats the same failing tool call; unset is on. */
  forkAgentGuardLoop?: boolean
  /** Fork (SLRM-2385): failures of the same call (same tool, input and error) before the warning; unset is 6. */
  forkAgentGuardLoopRepeats?: number
  /** Fork (SLRM-2385): pause the agent when the call fails again after the warning; unset is on. */
  forkAgentGuardLoopPause?: boolean
  /** Fork (SLRM-2385): estimated USD a chat may spend before it is paused at its turn's end; 0 or unset is off. */
  forkAgentGuardSpendCapUsd?: number
  /** Fork (SLRM-2385): which chats the default spend cap covers: orchestration workers or all chats; unset is workers. */
  forkAgentGuardSpendCapScope?: AgentGuardSpendScope
  /** Fork (SLRM-2385): tell the Decision inbox's notify targets when a guard pauses an agent; unset is on. */
  forkAgentGuardNotify?: boolean
  /** Fork (BAD-679): estimated USD a Run (a coordinator and its workers together) may spend before every member is paused; 0 or unset is off. */
  forkAgentGuardRunCapUsd?: number
  /** Fork (BAD-679): estimated USD one run of an automation may spend before its agent is paused; 0 or unset is off. */
  forkAutomationCapRunUsd?: number
  /** Fork (BAD-679): estimated USD an automation's runs may spend in one local day before further runs are skipped; 0 or unset is off. */
  forkAutomationCapDayUsd?: number
  /** Fork (BAD-679): estimated USD an automation's runs may spend in the last 7 local days before further runs are skipped; 0 or unset is off. */
  forkAutomationCapWeekUsd?: number
}

export type AgentGuardSettings = {
  loop: boolean
  repeats: number
  pauseAfterWarning: boolean
  capUsd: number
  capScope: AgentGuardSpendScope
  notify: boolean
  /** Per-Run default cap (BAD-679); 0 is off. */
  runCapUsd: number
  /** Defaults for every automation (BAD-679); 0 is off. */
  automationRunCapUsd: number
  automationDayCapUsd: number
  automationWeekCapUsd: number
}

export type AgentGuardSettingsSource =
  | Partial<Record<keyof ForkAgentGuardSettings, unknown>>
  | null
  | undefined

export function readAgentGuardSettings(source: AgentGuardSettingsSource): AgentGuardSettings {
  const repeats = source?.forkAgentGuardLoopRepeats
  const cap = source?.forkAgentGuardSpendCapUsd
  return {
    loop: source?.forkAgentGuardLoop !== false,
    repeats:
      typeof repeats === 'number' &&
      Number.isInteger(repeats) &&
      repeats >= AGENT_GUARD_MIN_REPEATS &&
      repeats <= AGENT_GUARD_MAX_REPEATS
        ? repeats
        : AGENT_GUARD_DEFAULT_REPEATS,
    pauseAfterWarning: source?.forkAgentGuardLoopPause !== false,
    capUsd: normalizeAgentGuardCap(cap) ?? 0,
    capScope: source?.forkAgentGuardSpendCapScope === 'all' ? 'all' : 'workers',
    notify: source?.forkAgentGuardNotify !== false,
    runCapUsd: normalizeAgentGuardCap(source?.forkAgentGuardRunCapUsd) ?? 0,
    automationRunCapUsd: normalizeAgentGuardCap(source?.forkAutomationCapRunUsd) ?? 0,
    automationDayCapUsd: normalizeAgentGuardCap(source?.forkAutomationCapDayUsd) ?? 0,
    automationWeekCapUsd: normalizeAgentGuardCap(source?.forkAutomationCapWeekUsd) ?? 0
  }
}

/** True when a setting gives some agent, Run or automation a default spend cap (BAD-679). */
export function agentGuardAnyCapSet(
  settings: Pick<
    AgentGuardSettings,
    'capUsd' | 'runCapUsd' | 'automationRunCapUsd' | 'automationDayCapUsd' | 'automationWeekCapUsd'
  >
): boolean {
  return (
    settings.capUsd > 0 ||
    settings.runCapUsd > 0 ||
    settings.automationRunCapUsd > 0 ||
    settings.automationDayCapUsd > 0 ||
    settings.automationWeekCapUsd > 0
  )
}

/** A cap in USD, or null for none (0, negative, not a number or past the ceiling). */
export function normalizeAgentGuardCap(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= AGENT_GUARD_MAX_CAP_USD
    ? Math.round(value * 100) / 100
    : null
}

// The loop rule lives in agent-guards-loop.ts; its names are exported from here too.
export * from './agent-guards-loop'

// --- Spend ---

/**
 * The cap that covers a chat: its own (set by `orca guards cap`) wins, else the default when the
 * scope covers it. Null when none does.
 */
export function agentGuardCapFor(
  own: number | null | undefined,
  isWorker: boolean,
  settings: Pick<AgentGuardSettings, 'capUsd' | 'capScope'>
): number | null {
  if (typeof own === 'number') {
    return own > 0 ? own : null
  }
  if (settings.capUsd <= 0) {
    return null
  }
  return settings.capScope === 'all' || isWorker ? settings.capUsd : null
}

// --- Entries ---

export type AgentGuardReason = 'loop' | 'spend'

/**
 * What a cap counts (BAD-679):
 * - chat: one agent's own spend (the default cap, or `orca guards cap`).
 * - run: a coordinator and all its workers together.
 * - automation-run / automation-day / automation-week: what an automation's runs spent.
 */
export type AgentGuardCapScope =
  | 'chat'
  | 'run'
  | 'automation-run'
  | 'automation-day'
  | 'automation-week'

export const AGENT_GUARD_CAP_SCOPES: readonly AgentGuardCapScope[] = [
  'chat',
  'run',
  'automation-run',
  'automation-day',
  'automation-week'
]

export function isAgentGuardCapScope(value: unknown): value is AgentGuardCapScope {
  return AGENT_GUARD_CAP_SCOPES.some((scope) => scope === value)
}

const SCOPE_WORDS: Record<AgentGuardCapScope, string> = {
  chat: 'its',
  run: "its Run's",
  'automation-run': "its automation run's",
  'automation-day': "its automation's daily",
  'automation-week': "its automation's weekly"
}

/** One cap that covers an agent and what has been spent against it. */
export type AgentGuardLimit = { scope: AgentGuardCapScope; capUsd: number; spentUsd: number }

/** The limit closest to (or past) its cap, by share used. */
export function tightestAgentGuardLimit(
  limits: readonly AgentGuardLimit[]
): AgentGuardLimit | null {
  let best: AgentGuardLimit | null = null
  for (const limit of limits) {
    if (!best || limit.spentUsd / limit.capUsd > best.spentUsd / best.capUsd) {
      best = limit
    }
  }
  return best
}

/** One guarded agent, as the status line, the inbox and `orca guards list` show it. */
export type AgentGuardEntry = {
  /** `chat:<session id>` for a native chat, else the terminal pane key. */
  id: string
  kind: 'chat' | 'terminal'
  sessionId?: string
  paneKey?: string
  agent: string
  title: string
  worktreeId: string | null
  /**
   * - warned: told to change approach; it goes on.
   * - paused: interrupted or held at its turn's end; it waits for a person.
   * - capped: has a spend cap and is under it.
   */
  state: 'warned' | 'paused' | 'capped'
  reason: AgentGuardReason | null
  /** Epoch ms the state began. */
  since: number
  /** Failures of the looping call, for a loop. */
  repeats?: number
  /** Tool of the looping call, capped and stripped of control characters. */
  tool?: string
  /** Estimated USD since the cap began or was last reset, for an agent with a cap (the tightest one). */
  spentUsd?: number
  capUsd?: number
  /** Which cap spentUsd and capUsd are, and every cap that covers the agent with its spend (BAD-679). */
  scope?: AgentGuardCapScope
  limits?: AgentGuardLimit[]
  /** True when a pause could not interrupt the agent (a terminal agent with no key to stop it). */
  notInterrupted?: boolean
}

// oxlint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL = /[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g

export function agentGuardLabel(text: string, max = 80): string {
  return text.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

/** One plain sentence on why, with no tool output in it. */
export function agentGuardReasonText(entry: AgentGuardEntry): string {
  const money = (value: number | undefined): string => `$${(value ?? 0).toFixed(2)}`
  if (entry.reason === 'spend') {
    const whose = SCOPE_WORDS[entry.scope ?? 'chat']
    return `Paused: estimated spend ${money(entry.spentUsd)} passed ${whose} cap of ${money(entry.capUsd)}.`
  }
  if (entry.reason === 'loop') {
    const tool = entry.tool ? ` (${entry.tool})` : ''
    return entry.state === 'warned'
      ? `Warned: the same tool call${tool} failed ${entry.repeats ?? 0} times with the same error.`
      : `Paused: the same tool call${tool} kept failing after a warning (${entry.repeats ?? 0} times).`
  }
  return `Spend cap ${money(entry.capUsd)}, ${money(entry.spentUsd)} spent.`
}

const STATES = new Set<unknown>(['warned', 'paused', 'capped'])

function isAgentGuardEntry(entry: unknown): entry is AgentGuardEntry {
  if (typeof entry !== 'object' || entry === null) {
    return false
  }
  const fields = new Map<string, unknown>(Object.entries(entry))
  return (
    typeof fields.get('id') === 'string' &&
    (fields.get('kind') === 'chat' || fields.get('kind') === 'terminal') &&
    STATES.has(fields.get('state')) &&
    typeof fields.get('title') === 'string'
  )
}

/** Entries from main, checked: a malformed one is dropped. */
export function normalizeAgentGuardEntries(value: unknown): AgentGuardEntry[] {
  return Array.isArray(value) ? value.filter(isAgentGuardEntry) : []
}
