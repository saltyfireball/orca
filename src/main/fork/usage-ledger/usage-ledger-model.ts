// SLRM-2103 (FORK.md "Usage ledger and cache-cold cue"): the ledger's saved shape, and reading it
// back from disk tolerantly (anything malformed is dropped, never thrown).
import {
  FORK_USAGE_NO_TOKENS,
  type ForkCacheTtl,
  type ForkUsageBilling,
  type ForkUsageTokens
} from '../../../shared/fork/usage-ledger'

/** Usage of one model on one day: tokens plus the number of provider calls. */
export type UsageCell = { tokens: ForkUsageTokens; calls: number }

export type UsageChatRecord = {
  sessionId: string
  agent: string
  /** The chat's name when it was last seen. */
  title?: string
  workspaceId?: string
  /** Workspace display name (follows the branch unless the user pinned a name). */
  workspaceName?: string
  /** The chat that dispatched this one as an orchestration worker. */
  parentSessionId?: string
  billing?: ForkUsageBilling
  firstAt: number
  lastAt: number
  turns: number
  /** Local day (YYYY-MM-DD) to model to usage. */
  days: Record<string, Record<string, UsageCell>>
  /** Prompt size of the last main-thread call; 0 after a compaction until the next call. */
  contextTokens: number
  ttl?: ForkCacheTtl
  /** Latest calls seen, with the highest counts each reported, so repeated frames add nothing. */
  recentCalls: [string, ForkUsageTokens][]
}

export type UsageLedgerData = { version: 1; chats: Record<string, UsageChatRecord> }

/** Unpriced or unnamed model bucket. */
export const UNKNOWN_MODEL = 'unknown'

export const RECENT_CALLS_KEPT = 16

export function emptyLedgerData(): UsageLedgerData {
  return { version: 1, chats: {} }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function readTokens(value: unknown): ForkUsageTokens {
  const raw = record(value)
  const tokens: ForkUsageTokens = {
    inputTokens: num(raw?.inputTokens),
    outputTokens: num(raw?.outputTokens),
    cacheReadTokens: num(raw?.cacheReadTokens),
    cacheWriteTokens: num(raw?.cacheWriteTokens),
    cacheWrite1hTokens: num(raw?.cacheWrite1hTokens)
  }
  const long = record(raw?.longContext)
  if (long) {
    const { longContext: _drop, ...flat } = readTokens(long)
    tokens.longContext = flat
  }
  return tokens
}

export function addTokens(left: ForkUsageTokens, right: ForkUsageTokens): ForkUsageTokens {
  const sum: ForkUsageTokens = {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
    cacheWrite1hTokens: left.cacheWrite1hTokens + right.cacheWrite1hTokens
  }
  if (left.longContext || right.longContext) {
    const { longContext: _drop, ...long } = addTokens(
      left.longContext ?? FORK_USAGE_NO_TOKENS,
      right.longContext ?? FORK_USAGE_NO_TOKENS
    )
    sum.longContext = long
  }
  return sum
}

export function totalTokens(tokens: ForkUsageTokens): number {
  return tokens.inputTokens + tokens.outputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens
}

function readDays(value: unknown): UsageChatRecord['days'] {
  const days: UsageChatRecord['days'] = {}
  for (const [day, models] of Object.entries(record(value) ?? {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      continue
    }
    const cells: Record<string, UsageCell> = {}
    for (const [model, cell] of Object.entries(record(models) ?? {})) {
      const raw = record(cell)
      if (raw) {
        cells[model] = { tokens: readTokens(raw.tokens), calls: num(raw.calls) }
      }
    }
    days[day] = cells
  }
  return days
}

function readChat(sessionId: string, value: unknown): UsageChatRecord | null {
  const raw = record(value)
  if (!raw) {
    return null
  }
  const ttl = raw.ttl === '5m' || raw.ttl === '1h' ? raw.ttl : undefined
  const billing = raw.billing === 'api' || raw.billing === 'subscription' ? raw.billing : undefined
  const recent = Array.isArray(raw.recentCalls) ? raw.recentCalls : []
  const optional = {
    title: str(raw.title),
    workspaceId: str(raw.workspaceId),
    workspaceName: str(raw.workspaceName),
    parentSessionId: str(raw.parentSessionId),
    billing,
    ttl
  }
  return {
    sessionId,
    agent: str(raw.agent) ?? 'claude',
    ...Object.fromEntries(Object.entries(optional).filter(([, entry]) => entry !== undefined)),
    firstAt: num(raw.firstAt),
    lastAt: num(raw.lastAt),
    turns: num(raw.turns),
    days: readDays(raw.days),
    contextTokens: num(raw.contextTokens),
    recentCalls: recent
      .filter(
        (entry): entry is [string, unknown] => Array.isArray(entry) && typeof entry[0] === 'string'
      )
      .slice(-RECENT_CALLS_KEPT)
      .map(([id, tokens]) => [id, readTokens(tokens)])
  }
}

export function parseLedgerData(text: string): UsageLedgerData {
  const parsed = record(JSON.parse(text))
  const data = emptyLedgerData()
  if (parsed?.version !== 1) {
    return data
  }
  for (const [sessionId, chat] of Object.entries(record(parsed.chats) ?? {})) {
    const read = readChat(sessionId, chat)
    if (read) {
      data.chats[sessionId] = read
    }
  }
  return data
}

/** Local calendar day of a timestamp, as YYYY-MM-DD. */
export function localDayKey(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
