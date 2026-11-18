// Idle recovery (FORK.md), item D: the sweep wired to this process, and the calls the runtime
// RPC and the window bridge answer with.
// Contract: `startForkIdleRecovery` is called once at start-up. While the mode is 'off' it runs
// no sweep, reads no chat and starts no process; the timer (`startForkBackoffTimer`) must back
// off while off and start over when `forkIdleSweepMode` changes. Each sweep loads the state,
// runs `runIdleRecoverySweep`, saves, calls `notifyIdleRecoveryWaiting` for new waits and tells
// the change listeners. Keep electron out of this file: the bridge owns the windows.
// The state file is read on the first sweep or inbox read with the mode on, then kept in memory
// and saved whenever a sweep or an answer changed it. Sweeps never overlap.
import type { ForkGlobalSettings } from '../../../shared/fork/fork-global-settings'
import {
  readIdleRecoverySettings,
  withIdleRecoveryPaused,
  type IdleRecoverySettingsSource
} from '../../../shared/fork/idle-recovery-settings'
import type {
  ForkIdleRecoveryAnswerRequest,
  ForkIdleRecoveryAnswerResult,
  ForkIdleRecoveryInboxResult,
  ForkIdleRecoveryPauseRequest,
  ForkIdleRecoveryPauseResult,
  ForkIdleRecoveryStatusResult
} from '../../../shared/fork/idle-recovery-wire'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { startForkBackoffTimer } from '../fork-backoff-timer'
import { setIdleRecoveryRuntime } from './idle-recovery-host'
import { notifyIdleRecoveryWaiting } from './idle-recovery-notify'
import { setIdleRecoveryTerminalRuntime } from './idle-recovery-ports'
import {
  listIdleRecoveryInboxItems,
  loadIdleRecoveryState,
  saveIdleRecoveryState,
  type IdleRecoveryStoredState
} from './idle-recovery-state'
import { runIdleRecoverySweep } from './idle-recovery-sweep'
import { sendIdleRecoveryAnswer } from './idle-recovery-wake'
import {
  answerFromInboxSource,
  inboxSourceItems,
  pauseFromInboxSource
} from './idle-recovery-sources'

export const FORK_IDLE_RECOVERY_SWEEP_MS = 15_000
/** While the mode is off the timer backs off to this; without a store to tell of the change,
 *  turning the mode on is seen within it. */
export const FORK_IDLE_RECOVERY_IDLE_SWEEP_MS = 2 * 60_000

/** The part of the settings store idle recovery uses: to save a pause and to hear of changes. */
export type IdleRecoveryStore = {
  getSettings: () => IdleRecoverySettingsSource
  updateSettings?: (
    updates: Pick<ForkGlobalSettings, 'forkIdleSweepPaused'>,
    options?: { notifyListeners?: boolean }
  ) => unknown
  onSettingsChanged?: (listener: (updates: Partial<ForkGlobalSettings>) => void) => unknown
}

export type IdleRecoveryServiceDeps = {
  now: () => number
  loadState: () => Promise<IdleRecoveryStoredState>
  saveState: (state: IdleRecoveryStoredState) => Promise<void>
  sweep: typeof runIdleRecoverySweep
  notify: typeof notifyIdleRecoveryWaiting
  sendAnswer: typeof sendIdleRecoveryAnswer
  startTimer: typeof startForkBackoffTimer
  /** Hands the runtime to the pieces that read and reach chats through it. */
  useRuntime: (read: () => OrcaRuntimeService | null) => void
}

/** What the start-up hook hands over besides the settings reader. Both are read when used. */
export type IdleRecoveryHooks = {
  /** Without it a pause cannot be saved and a mode change is seen only at the next timer run. */
  store?: () => IdleRecoveryStore | null | undefined
  /** Without it the candidate list finds the runtime itself and terminal agents are not woken. */
  runtime?: () => OrcaRuntimeService | null | undefined
}

export type IdleRecoveryService = ReturnType<typeof createIdleRecoveryService>

export function createIdleRecoveryService(overrides: Partial<IdleRecoveryServiceDeps> = {}) {
  const deps: IdleRecoveryServiceDeps = {
    now: Date.now,
    loadState: () => loadIdleRecoveryState(),
    saveState: (state) => saveIdleRecoveryState(state),
    sweep: runIdleRecoverySweep,
    notify: notifyIdleRecoveryWaiting,
    sendAnswer: sendIdleRecoveryAnswer,
    startTimer: startForkBackoffTimer,
    useRuntime: setIdleRecoveryTerminalRuntime,
    ...overrides
  }
  let readSettings: () => IdleRecoverySettingsSource = () => undefined
  let readStore: () => IdleRecoveryStore | null | undefined = () => null
  let readRuntime: () => OrcaRuntimeService | null | undefined = () => null
  const listeners = new Set<() => void>()
  const storesWatched = new WeakSet<object>()
  let stopTimer: (() => void) | null = null
  let loading: Promise<IdleRecoveryStoredState> | null = null
  let saving: Promise<void> = Promise.resolve()
  let running = false
  let lastSweepAt: number | null = null

  const settingsNow = () => readIdleRecoverySettings(readSettings())
  const loadedState = (): Promise<IdleRecoveryStoredState> => (loading ??= deps.loadState())

  const emit = (): void => {
    for (const listener of listeners) {
      try {
        listener()
      } catch (error) {
        console.warn('[fork idle recovery] change listener failed', error)
      }
    }
  }

  // One write at a time, each of the state as it is when its turn comes.
  const save = (state: IdleRecoveryStoredState): Promise<void> => {
    saving = saving
      .then(() => deps.saveState(state))
      .catch((error: unknown) => {
        console.warn('[fork idle recovery] could not save its state', error)
      })
    return saving
  }

  const startTimer = (): void => {
    stopTimer?.()
    stopTimer = deps.startTimer({
      run: sweep,
      baseMs: FORK_IDLE_RECOVERY_SWEEP_MS,
      maxMs: FORK_IDLE_RECOVERY_IDLE_SWEEP_MS,
      onError: (error) => console.warn('[fork idle recovery] sweep failed', error)
    })
  }

  // The store may not exist yet at start-up, so it is looked for again on each call.
  const watchStore = (): IdleRecoveryStore | null => {
    const store = readStore() ?? null
    if (store?.onSettingsChanged && !storesWatched.has(store)) {
      storesWatched.add(store)
      store.onSettingsChanged((updates) => {
        if ('forkIdleSweepMode' in updates) {
          // The backed-off wait starts over, so turning the mode on is seen within one sweep.
          if (stopTimer) {
            startTimer()
          }
          emit()
        }
      })
    }
    return store
  }

  async function sweep(): Promise<boolean> {
    watchStore()
    const settings = settingsNow()
    if (settings.mode === 'off') {
      return false
    }
    if (running) {
      return true
    }
    running = true
    try {
      // The candidate reader keeps the runtime itself, and it may not exist yet at start-up.
      setIdleRecoveryRuntime(readRuntime() ?? null)
      const state = await loadedState()
      const before = JSON.stringify(state)
      const result = await deps.sweep({ settings, nowMs: deps.now(), state })
      lastSweepAt = deps.now()
      if (JSON.stringify(state) !== before) {
        await save(state)
      }
      if (result.newlyWaiting.length > 0) {
        await deps.notify(result.newlyWaiting, settings)
      }
      if (result.changed) {
        emit()
      }
    } catch (error) {
      console.warn('[fork idle recovery] sweep failed', error)
    } finally {
      running = false
    }
    return true
  }

  return {
    /** Idempotent: a second call swaps the readers and keeps the timer. */
    start(reader: () => IdleRecoverySettingsSource, hooks: IdleRecoveryHooks = {}): void {
      readSettings = reader
      readStore = hooks.store ?? (() => null)
      readRuntime = hooks.runtime ?? (() => null)
      deps.useRuntime(() => readRuntime() ?? null)
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

    onChanged(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    async listInbox(): Promise<ForkIdleRecoveryInboxResult> {
      const settings = settingsNow()
      const extra = await inboxSourceItems()
      if (settings.mode === 'off') {
        return { now: deps.now(), mode: 'off', items: extra }
      }
      const paused = new Set(settings.paused)
      const items = listIdleRecoveryInboxItems(await loadedState())
      return {
        now: deps.now(),
        mode: settings.mode,
        // The setting is the truth about a pause: a row learns of it only at the next sweep.
        items: [...items.map((item) => ({ ...item, paused: paused.has(item.chatId) })), ...extra]
      }
    },

    async answer(request: ForkIdleRecoveryAnswerRequest): Promise<ForkIdleRecoveryAnswerResult> {
      const { chatId } = request
      if (request.source) {
        return { chatId, result: await answerFromInboxSource(request.source, chatId, request.text) }
      }
      if (settingsNow().mode === 'off') {
        return { chatId, result: 'unavailable' }
      }
      const state = await loadedState()
      const row = state.chats[chatId]
      if (!row) {
        return { chatId, result: 'not-found' }
      }
      if (!row.listed || row.verdict === 'finished') {
        return { chatId, result: 'not-waiting' }
      }
      const result = await deps.sendAnswer(chatId, request.text, {
        kind: row.kind,
        agent: row.agent
      })
      if (result === 'sent') {
        // The user's own turn: off the inbox, and the chat has its wakes back.
        row.verdict = 'finished'
        row.question = ''
        row.nextStep = ''
        row.wakeAt = null
        row.wakes = 0
        await save(state)
        emit()
      }
      return { chatId, result }
    },

    async setPaused(request: ForkIdleRecoveryPauseRequest): Promise<ForkIdleRecoveryPauseResult> {
      const { chatId } = request
      if (request.source) {
        return pauseFromInboxSource(request, readIdleRecoverySettings(readSettings()).paused.length)
      }
      const store = watchStore()
      let saved = false
      if (store?.updateSettings) {
        try {
          store.updateSettings(
            withIdleRecoveryPaused(store.getSettings(), chatId, request.paused),
            {
              notifyListeners: true
            }
          )
          saved = true
        } catch (error) {
          console.warn('[fork idle recovery] could not save a pause', error)
        }
      }
      const { paused } = readIdleRecoverySettings(saved ? store?.getSettings() : readSettings())
      if (saved) {
        emit()
      }
      return { chatId, paused: paused.includes(chatId), pausedCount: paused.length, saved }
    },

    async readStatus(): Promise<ForkIdleRecoveryStatusResult> {
      const settings = settingsNow()
      const on = settings.mode !== 'off'
      const pausedIds = new Set(settings.paused)
      // A paused row is frozen as it was, so it is in neither count (the inbox shows it apart).
      const items = on
        ? listIdleRecoveryInboxItems(await loadedState()).filter(
            (item) => !pausedIds.has(item.chatId)
          )
        : []
      return {
        mode: settings.mode,
        running: on && stopTimer !== null,
        classifier: settings.classifierCommand ? 'command' : 'builtin',
        lastSweepAt,
        waiting: items.filter((item) => item.verdict === 'waiting_user').length,
        stalled: items.filter((item) => item.verdict === 'stalled').length,
        paused: settings.paused
      }
    }
  }
}

const service = createIdleRecoveryService()

/** Hook in `src/main/index.ts`. Idempotent. */
export function startForkIdleRecovery(
  reader: () => IdleRecoverySettingsSource,
  hooks?: IdleRecoveryHooks
): void {
  service.start(reader, hooks)
}

/** One sweep now. Resolves false while the mode is 'off', so a backoff timer backs off. */
export function sweepForkIdleRecovery(): Promise<boolean> {
  return service.sweep()
}

/** Calls `listener` whenever the inbox changes; returns its unsubscribe. */
export function onIdleRecoveryChanged(listener: () => void): () => void {
  return service.onChanged(listener)
}

export function listIdleRecoveryInbox(): Promise<ForkIdleRecoveryInboxResult> {
  return service.listInbox()
}

export function answerIdleRecoveryChat(
  request: ForkIdleRecoveryAnswerRequest
): Promise<ForkIdleRecoveryAnswerResult> {
  return service.answer(request)
}

export function setIdleRecoveryPaused(
  request: ForkIdleRecoveryPauseRequest
): Promise<ForkIdleRecoveryPauseResult> {
  return service.setPaused(request)
}

export function readIdleRecoveryStatus(): Promise<ForkIdleRecoveryStatusResult> {
  return service.readStatus()
}
