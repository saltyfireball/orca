// SLRM-2103 (FORK.md "Usage ledger and cache-cold cue"): per-turn token usage of native chats,
// kept by main in one small ledger. The cache-cold cue and the usage report both read it. Shared
// by main, preload and the renderer.
import type { ForkUsageReportApi } from './usage-report'

/** Token counts in the shape the built-in price table takes; cache writes include 1 h writes. */
export type ForkUsageTokens = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cacheWrite1hTokens: number
  /** Subset from requests over a model's long-context threshold. */
  longContext?: Omit<ForkUsageTokens, 'longContext'>
}

export const FORK_USAGE_NO_TOKENS: Readonly<ForkUsageTokens> = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  cacheWrite1hTokens: 0
}

/** How the provider bills the chat: per token, or a subscription that is not billed per token. */
export type ForkUsageBilling = 'api' | 'subscription'

/** Prompt cache lifetime the provider reported, when its usage said so. */
export type ForkCacheTtl = '5m' | '1h'

/** One chat's prompt cache, as the cache-cold cue needs it. */
export type ForkCacheState = {
  sessionId: string
  /** When the last provider call of the chat finished (ms epoch). */
  lastAt: number
  /** Tokens the next call re-reads: the context of the last main-thread call. */
  contextTokens: number
  /** Cache lifetime seen in the usage, or absent when the provider did not say. */
  ttl?: ForkCacheTtl
  /** A turn is running, so the cache is warm by definition. */
  working: boolean
}

export type ForkUsageLedgerSettings = {
  /** Fork (SLRM-2103): show the cache-cold cue on composer and chat row; unset is on. */
  forkCacheColdCue?: boolean
  /** Fork (SLRM-2103): minutes an idle prompt cache lives when usage does not say; unset is 5. */
  forkCacheWindowMinutes?: number
  /** Fork (SLRM-2103): smallest context worth the cue, in tokens; unset is 50000. */
  forkCacheColdThresholdTokens?: number
  /** Fork (SLRM-2104): regex over branch or workspace name; group 1 (or the match) is the card. */
  forkUsageCardPattern?: string
  /** Fork (SLRM-2104): user price table, USD per million tokens, by model; empty uses defaults. */
  forkUsagePrices?: Record<string, ForkUsagePrice>
  /** Fork (SLRM-2104): days of usage history the ledger keeps; unset is 90. */
  forkUsageRetentionDays?: number
}

/** USD per million tokens. A missing 1 h write rate falls back to the 5 min write rate. */
export type ForkUsagePrice = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cacheWrite1h?: number
}

export const FORK_CACHE_WINDOW_DEFAULT_MINUTES = 5
export const FORK_CACHE_WINDOW_MAX_MINUTES = 24 * 60
export const FORK_CACHE_COLD_DEFAULT_THRESHOLD = 50_000
export const FORK_USAGE_RETENTION_DEFAULT_DAYS = 90
export const FORK_USAGE_RETENTION_MAX_DAYS = 3650

function finiteOr(value: number | undefined, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback
}

export type ForkCacheColdConfig = { enabled: boolean; windowMinutes: number; threshold: number }

export function forkCacheColdConfig(
  settings: ForkUsageLedgerSettings | undefined
): ForkCacheColdConfig {
  return {
    enabled: settings?.forkCacheColdCue !== false,
    windowMinutes: finiteOr(
      settings?.forkCacheWindowMinutes,
      FORK_CACHE_WINDOW_DEFAULT_MINUTES,
      1,
      FORK_CACHE_WINDOW_MAX_MINUTES
    ),
    threshold: Math.round(
      finiteOr(settings?.forkCacheColdThresholdTokens, FORK_CACHE_COLD_DEFAULT_THRESHOLD, 0, 1e9)
    )
  }
}

export function forkUsageRetentionDays(settings: ForkUsageLedgerSettings | undefined): number {
  return Math.round(
    finiteOr(
      settings?.forkUsageRetentionDays,
      FORK_USAGE_RETENTION_DEFAULT_DAYS,
      1,
      FORK_USAGE_RETENTION_MAX_DAYS
    )
  )
}

/** The window the cue uses: a TTL the provider reported wins over the setting. */
export function forkCacheWindowMs(
  state: Pick<ForkCacheState, 'ttl'>,
  config: ForkCacheColdConfig
): number {
  if (state.ttl === '1h') {
    return 60 * 60_000
  }
  if (state.ttl === '5m') {
    return 5 * 60_000
  }
  return config.windowMinutes * 60_000
}

export type ForkCacheColdVerdict = { cold: false } | { cold: true; tokens: number; idleMs: number }

/** Likely cold: idle past the window with a context at or above the threshold, and not working. */
export function forkCacheColdVerdict(
  state: ForkCacheState | undefined,
  config: ForkCacheColdConfig,
  now: number
): ForkCacheColdVerdict {
  if (!config.enabled || !state || state.working || state.contextTokens <= 0) {
    return { cold: false }
  }
  if (state.contextTokens < config.threshold) {
    return { cold: false }
  }
  const idleMs = now - state.lastAt
  return idleMs >= forkCacheWindowMs(state, config)
    ? { cold: true, tokens: state.contextTokens, idleMs }
    : { cold: false }
}

/** Ms until the chat crosses its window, or null when it never will without new usage. */
export function forkCacheColdInMs(
  state: ForkCacheState | undefined,
  config: ForkCacheColdConfig,
  now: number
): number | null {
  if (!config.enabled || !state || state.working || state.contextTokens < config.threshold) {
    return null
  }
  return Math.max(0, state.lastAt + forkCacheWindowMs(state, config) - now)
}

/** Compact token count for UI copy: 950, 12k, 1.2M. */
export function formatForkTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 0 : 1)}M`
  }
  if (tokens >= 1000) {
    return `${Math.round(tokens / 1000)}k`
  }
  return String(Math.round(tokens))
}

/** window.api.forkUsageLedger; desktop only. The report side is SLRM-2104's. */
export type ForkUsageLedgerApi = ForkUsageReportApi & {
  cacheStates: () => Promise<ForkCacheState[]>
  onCacheChanged: (callback: (states: ForkCacheState[]) => void) => () => void
}

export const FORK_USAGE_LEDGER_CHANNELS = {
  cacheStates: 'fork:usage-ledger:cache-states',
  cacheChanged: 'fork:usage-ledger:cache-changed',
  report: 'fork:usage-ledger:report',
  clear: 'fork:usage-ledger:clear',
  defaultPrices: 'fork:usage-ledger:default-prices'
} as const
