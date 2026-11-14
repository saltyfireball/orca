// Boundary compaction (FORK.md): the sweep, wired to this process.
// Contract: `startForkBoundaryCompactionService` is called once at start-up. While the mode is 'off' a
// run reads the setting and nothing else: no chat is read and nothing is sent, and the timer
// (`startForkBackoffTimer`) backs off; it starts over when `forkBoundaryCompactMode` changes.
// With the mode on, each run looks at the chats whose agent runs here and asks at most the ones
// the rule in `src/shared/fork/boundary-compaction.ts` allows to compact, once per turn ending.
// It does not depend on idle recovery being on. Keep electron out of this file.
import { randomUUID } from 'node:crypto'
import {
  boundaryCompactionEndingKey,
  boundaryCompactionJournalRefusal,
  boundaryCompactionRefusalIsSettled,
  boundaryCompactionRestRefusal,
  forkBoundaryCompactionOperationId,
  readBoundaryCompactionSettings,
  type BoundaryCompactionRefusal,
  type BoundaryCompactionRestFacts,
  type BoundaryCompactionSettings,
  type BoundaryCompactionSettingsSource
} from '../../../shared/fork/boundary-compaction'
import type { ForkGlobalSettings } from '../../../shared/fork/fork-global-settings'
import {
  readIdleRecoverySettings,
  type IdleRecoverySettingsSource
} from '../../../shared/fork/idle-recovery-settings'
import {
  forkCacheColdConfig,
  forkCacheWindowMs,
  type ForkCacheState,
  type ForkUsageLedgerSettings
} from '../../../shared/fork/usage-ledger'
import { startForkBackoffTimer } from '../fork-backoff-timer'
import { forkUsageLedgerCacheStates } from '../usage-ledger/usage-ledger-service'
import {
  liveBoundaryCompactionHost,
  type BoundaryCompactionChatRest,
  type BoundaryCompactionHost,
  type BoundaryCompactionSendOutcome
} from './boundary-compaction-host'
import {
  clearForkBoundaryCompactionTyped,
  forkBoundaryCompactionTyped
} from './boundary-compaction-typed'

export const FORK_BOUNDARY_COMPACTION_SWEEP_MS = 30_000
/** While the mode is off the timer backs off to this; without a store to tell of the change,
 *  turning the mode on is seen within it. */
export const FORK_BOUNDARY_COMPACTION_IDLE_SWEEP_MS = 2 * 60_000

/** The settings the sweep reads: its own, the chats idle recovery is told to leave alone, and
 *  the prompt cache lifetime of the cache-cold cue. */
export type BoundaryCompactionSettingsReader = () =>
  | (NonNullable<BoundaryCompactionSettingsSource> &
      NonNullable<IdleRecoverySettingsSource> &
      ForkUsageLedgerSettings)
  | null
  | undefined

export type BoundaryCompactionStore = {
  onSettingsChanged?: (listener: (updates: Partial<ForkGlobalSettings>) => void) => unknown
}

export type BoundaryCompactionServiceDeps = {
  now: () => number
  host: BoundaryCompactionHost
  /** Whether a window holds text for the chat; null when no window has reported. */
  typed: (sessionId: string) => boolean | null
  /** Drops every window's report; a window reports again when the mode comes back on. */
  forgetTyped: () => void
  /** The usage ledger's view of each chat's prompt cache; empty where there is no ledger. */
  cacheStates: () => readonly ForkCacheState[]
  startTimer: typeof startForkBackoffTimer
  randomId: () => string
}

/** What the last sweep did with one chat. */
export type BoundaryCompactionOutcome = BoundaryCompactionRefusal | BoundaryCompactionSendOutcome

export type BoundaryCompactionService = ReturnType<typeof createBoundaryCompactionService>

export function createBoundaryCompactionService(
  overrides: Partial<BoundaryCompactionServiceDeps> = {}
) {
  const deps: BoundaryCompactionServiceDeps = {
    now: Date.now,
    host: overrides.host ?? liveBoundaryCompactionHost(),
    typed: forkBoundaryCompactionTyped,
    forgetTyped: () => clearForkBoundaryCompactionTyped(),
    cacheStates: forkUsageLedgerCacheStates,
    startTimer: startForkBackoffTimer,
    randomId: () => randomUUID().replaceAll('-', ''),
    ...overrides
  }
  let readSettings: BoundaryCompactionSettingsReader = () => undefined
  let readStore: () => BoundaryCompactionStore | null | undefined = () => null
  const storesWatched = new WeakSet<object>()
  let stopTimer: (() => void) | null = null
  let running = false
  /** The turn ending each chat was last asked to compact for. */
  const tried = new Map<string, string>()
  /** The `idleSince` at which a chat's journal gave a refusal that holds until its next turn. */
  const settled = new Map<string, number>()
  const outcomes = new Map<string, BoundaryCompactionOutcome>()

  const forget = (): void => {
    tried.clear()
    settled.clear()
    outcomes.clear()
    deps.forgetTyped()
  }

  const startTimer = (): void => {
    stopTimer?.()
    stopTimer = deps.startTimer({
      run: sweep,
      baseMs: FORK_BOUNDARY_COMPACTION_SWEEP_MS,
      maxMs: FORK_BOUNDARY_COMPACTION_IDLE_SWEEP_MS,
      onError: (error) => console.warn('[fork boundary compaction] sweep failed', error)
    })
  }

  // The store may not exist yet at start-up, so it is looked for again on each run.
  const watchStore = (): void => {
    const store = readStore() ?? null
    if (store?.onSettingsChanged && !storesWatched.has(store)) {
      storesWatched.add(store)
      store.onSettingsChanged((updates) => {
        // The backed-off wait starts over, so turning the mode on is seen within one sweep.
        if ('forkBoundaryCompactMode' in updates && stopTimer) {
          startTimer()
        }
      })
    }
  }

  const restFacts = (
    sessionId: string,
    rest: BoundaryCompactionChatRest,
    paused: ReadonlySet<string>,
    caches: ReadonlyMap<string, ForkCacheState>,
    cacheConfig: ReturnType<typeof forkCacheColdConfig>
  ): BoundaryCompactionRestFacts => {
    const cache = caches.get(sessionId)
    return {
      compactable: rest.compactable,
      awake: rest.awake,
      inTurn: rest.inTurn,
      backgroundRunning: rest.backgroundRunning,
      paused: paused.has(sessionId),
      typed: deps.typed(sessionId),
      idleSince: rest.idleSince,
      lastCallAt: cache?.lastAt ?? null,
      // A lifetime the provider reported for this chat wins over the setting.
      cacheWindowMs: forkCacheWindowMs(cache ?? {}, cacheConfig)
    }
  }

  async function sweepChats(settings: BoundaryCompactionSettings): Promise<void> {
    const source = readSettings()
    const paused = new Set(readIdleRecoverySettings(source).paused)
    const cacheConfig = forkCacheColdConfig(source ?? undefined)
    const caches = new Map(deps.cacheStates().map((state) => [state.sessionId, state]))
    const chatIds = deps.host.chatIds()
    const refusalNow = (
      sessionId: string
    ): BoundaryCompactionChatRest | BoundaryCompactionRefusal => {
      const rest = deps.host.rest(sessionId)
      if (!rest) {
        return 'asleep'
      }
      return (
        boundaryCompactionRestRefusal(
          restFacts(sessionId, rest, paused, caches, cacheConfig),
          settings,
          deps.now()
        ) ?? rest
      )
    }
    outcomes.clear()
    for (const sessionId of chatIds) {
      const rest = refusalNow(sessionId)
      if (typeof rest === 'string') {
        outcomes.set(sessionId, rest)
        continue
      }
      if (rest.idleSince !== null && settled.get(sessionId) === rest.idleSince) {
        continue
      }
      const journal = await deps.host.journal(sessionId)
      if (!journal) {
        outcomes.set(sessionId, 'asleep')
        continue
      }
      const refusal = boundaryCompactionJournalRefusal(journal, settings, tried.get(sessionId))
      if (refusal) {
        outcomes.set(sessionId, refusal)
        if (boundaryCompactionRefusalIsSettled(refusal) && rest.idleSince !== null) {
          settled.set(sessionId, rest.idleSince)
        }
        continue
      }
      // The journal read gave the chat time to start a turn or the user time to type.
      const again = refusalNow(sessionId)
      if (typeof again === 'string') {
        outcomes.set(sessionId, again)
        continue
      }
      if (again.idleSince !== rest.idleSince) {
        outcomes.set(sessionId, 'working')
        continue
      }
      // Remembered before the send, so an attempt that fails is not made twice for one ending.
      tried.set(sessionId, boundaryCompactionEndingKey(journal))
      const outcome = await deps.host.compact(
        sessionId,
        again.fence,
        forkBoundaryCompactionOperationId(deps.now(), deps.randomId())
      )
      outcomes.set(sessionId, outcome)
    }
    const present = new Set(chatIds)
    for (const map of [tried, settled]) {
      for (const sessionId of map.keys()) {
        if (!present.has(sessionId)) {
          map.delete(sessionId)
        }
      }
    }
  }

  async function sweep(): Promise<boolean> {
    watchStore()
    const settings = readBoundaryCompactionSettings(readSettings())
    if (settings.mode === 'off') {
      forget()
      return false
    }
    if (running) {
      return true
    }
    running = true
    try {
      await sweepChats(settings)
    } catch (error) {
      console.warn('[fork boundary compaction] sweep failed', error)
    } finally {
      running = false
    }
    return true
  }

  return {
    /** Idempotent: a second call swaps the readers and keeps the timer. */
    start(
      reader: BoundaryCompactionSettingsReader,
      hooks: { store?: () => BoundaryCompactionStore | null | undefined } = {}
    ): void {
      readSettings = reader
      readStore = hooks.store ?? (() => null)
      watchStore()
      if (!stopTimer) {
        startTimer()
      }
    },

    stop(): void {
      stopTimer?.()
      stopTimer = null
    },

    sweep,

    /** What the last sweep did with each chat it looked at. */
    lastOutcomes(): ReadonlyMap<string, BoundaryCompactionOutcome> {
      return outcomes
    }
  }
}

let service: BoundaryCompactionService | null = null

/** Starts the sweep's timer. Idempotent. Called by the bridge from `src/main/index.ts`. */
export function startForkBoundaryCompactionService(
  reader: BoundaryCompactionSettingsReader,
  hooks?: { store?: () => BoundaryCompactionStore | null | undefined }
): void {
  service ??= createBoundaryCompactionService()
  service.start(reader, hooks)
}
