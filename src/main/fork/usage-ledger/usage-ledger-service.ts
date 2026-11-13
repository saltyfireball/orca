// SLRM-2103 (FORK.md "Usage ledger and cache-cold cue"): the main process's one ledger. A hook in
// Claude's structured event delivery feeds it live frames (transcript imports never pass there,
// so nothing is counted twice); the cache cue and the usage report read it.
import type { ClaudeStructuredSessionEvent } from '../../claude/structured/claude-structured-session-event'
import { longContextTurnTokens } from '../../claude-usage/claude-model-pricing'
import {
  forkUsageRetentionDays,
  type ForkCacheState,
  type ForkUsageLedgerSettings
} from '../../../shared/fork/usage-ledger'
import { startForkBackoffTimer } from '../fork-backoff-timer'
import { claudeUsageObservation } from './claude-usage-frames'
import { LedgerFileWriter, readLedgerFile, writeLedgerFile } from './usage-ledger-file'
import { UsageLedger, type UsageChatMeta } from './usage-ledger'
import type { UsageLedgerData } from './usage-ledger-model'

export type UsageLedgerServiceDeps = {
  filePath: string
  readSettings: () => ForkUsageLedgerSettings | undefined
  /** Name, workspace and dispatcher of a chat, read when it is first seen and after each turn. */
  chatMeta: (sessionId: string) => UsageChatMeta | undefined
  now?: () => number
}

/** Hourly after a prune that dropped rows, backing off to every 6 hours while nothing ages out. */
const PRUNE_EVERY_MS = 60 * 60_000
const PRUNE_MAX_MS = 6 * PRUNE_EVERY_MS
const CHANGE_PUSH_DELAY_MS = 500
/** Most chats sent to the window: the cue only matters for recent ones. */
const CACHE_STATES_SENT = 200

let ledger: UsageLedger | null = null
let service: UsageLedgerServiceDeps | null = null
let writer: LedgerFileWriter | null = null
let pushTimer: ReturnType<typeof setTimeout> | null = null
let stopPrune: (() => void) | null = null
const changeListeners = new Set<() => void>()

function notifyCacheChanged(): void {
  if (pushTimer) {
    return
  }
  pushTimer = setTimeout(() => {
    pushTimer = null
    for (const listener of changeListeners) {
      listener()
    }
  }, CHANGE_PUSH_DELAY_MS)
  pushTimer.unref?.()
}

/** Returns whether any rows aged out. */
function prune(): boolean {
  if (!ledger?.prune(forkUsageRetentionDays(service?.readSettings()))) {
    return false
  }
  writer?.schedule()
  return true
}

/**
 * Prunes at once when the retention setting changes, so a lower one does not wait for the
 * backed-off prune timer (SLRM-2138). Safe before the ledger loads: prune then does nothing.
 */
export function watchForkUsageRetention(store: {
  onSettingsChanged: (listener: (updates: Partial<ForkUsageLedgerSettings>) => void) => unknown
}): void {
  store.onSettingsChanged((updates) => {
    if ('forkUsageRetentionDays' in updates) {
      prune()
    }
  })
}

/** Main-process start-up: load the saved ledger and start counting. Returns the quit flush. */
export function installForkUsageLedgerService(deps: UsageLedgerServiceDeps): () => void {
  service = deps
  const now = deps.now ?? Date.now
  ledger = new UsageLedger(
    {
      now,
      isLongContext: (model, call) => longContextTurnTokens(model, call) !== undefined
    },
    readLedgerFile(deps.filePath)
  )
  const current = ledger
  writer = new LedgerFileWriter(() => writeLedgerFile(deps.filePath, current.snapshot()))
  prune()
  stopPrune?.()
  stopPrune = startForkBackoffTimer({
    run: async () => prune(),
    baseMs: PRUNE_EVERY_MS,
    maxMs: PRUNE_MAX_MS,
    onError: (error) => console.warn('[fork-usage-ledger] Could not prune the usage ledger:', error)
  })
  return () => writer?.flush()
}

function refreshMeta(sessionId: string): void {
  try {
    const meta = service?.chatMeta(sessionId)
    if (meta) {
      ledger?.noteMeta(sessionId, meta)
    }
  } catch {
    // Names are a nicety; a host that is shutting down simply leaves the last ones.
  }
}

/** Hook (Claude structured event delivery): every event of every live Claude chat. */
export function forkUsageLedgerObserveClaudeEvent(event: ClaudeStructuredSessionEvent): void {
  if (!ledger) {
    return
  }
  try {
    if (event.type === 'ended') {
      if (ledger.noteEnded(event.sessionId)) {
        notifyCacheChanged()
      }
      return
    }
    if (event.type !== 'message') {
      return
    }
    if (event.startsTurn) {
      ledger.noteTurnStart(event.sessionId)
      notifyCacheChanged()
    }
    const observation = claudeUsageObservation(event.message)
    if (!observation) {
      return
    }
    const known = ledger.has(event.sessionId)
    const changed = ledger.observe(event.sessionId, observation)
    if (!known || observation.kind === 'turn-end') {
      refreshMeta(event.sessionId)
    }
    writer?.schedule()
    if (changed) {
      notifyCacheChanged()
    }
  } catch (error) {
    // Counting must never disturb the chat itself.
    console.warn('[fork-usage-ledger] Could not record usage:', error)
  }
}

/** The most recently used chats' prompt caches, newest first. */
export function forkUsageLedgerCacheStates(): ForkCacheState[] {
  return (ledger?.cacheStates() ?? [])
    .sort((left, right) => right.lastAt - left.lastAt)
    .slice(0, CACHE_STATES_SENT)
}

export function onForkUsageLedgerCacheChanged(listener: () => void): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}

/** Everything recorded, for the usage report; read-only. */
export function forkUsageLedgerData(): UsageLedgerData | null {
  return ledger?.snapshot() ?? null
}

/** Clear history: forget all recorded usage and save the empty ledger at once. */
export function forkUsageLedgerClear(): void {
  if (!ledger) {
    return
  }
  ledger.clear()
  writer?.schedule()
  writer?.flush()
  notifyCacheChanged()
}

export function forkUsageLedgerSettings(): ForkUsageLedgerSettings | undefined {
  return service?.readSettings()
}
