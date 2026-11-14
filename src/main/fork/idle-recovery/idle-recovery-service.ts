// Idle recovery (FORK.md), item D: the sweep wired to this process, and the calls the runtime
// RPC and the window bridge answer with.
// Contract: `startForkIdleRecovery` is called once at start-up. While the mode is 'off' it runs
// no sweep, reads no chat and starts no process; the timer (`startForkBackoffTimer`) must back
// off while off and start over when `forkIdleSweepMode` changes. Each sweep loads the state,
// runs `runIdleRecoverySweep`, saves, calls `notifyIdleRecoveryWaiting` for new waits and tells
// the change listeners. Keep electron out of this file: the bridge owns the windows.
import {
  idleRecoveryEnabled,
  readIdleRecoverySettings,
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

let readSettings: () => IdleRecoverySettingsSource = () => undefined
const changeListeners = new Set<() => void>()

/** Hook in `src/main/index.ts`. Idempotent. */
export function startForkIdleRecovery(reader: () => IdleRecoverySettingsSource): void {
  readSettings = reader
}

/** One sweep now. Resolves false while the mode is 'off', so a backoff timer backs off. */
export async function sweepForkIdleRecovery(): Promise<boolean> {
  return idleRecoveryEnabled(readSettings())
}

/** Calls `listener` whenever the inbox changes; returns its unsubscribe. */
export function onIdleRecoveryChanged(listener: () => void): () => void {
  changeListeners.add(listener)
  return () => {
    changeListeners.delete(listener)
  }
}

export async function listIdleRecoveryInbox(): Promise<ForkIdleRecoveryInboxResult> {
  return { now: Date.now(), mode: readIdleRecoverySettings(readSettings()).mode, items: [] }
}

export async function answerIdleRecoveryChat(
  request: ForkIdleRecoveryAnswerRequest
): Promise<ForkIdleRecoveryAnswerResult> {
  return { chatId: request.chatId, result: 'unavailable' }
}

export async function setIdleRecoveryPaused(
  request: ForkIdleRecoveryPauseRequest
): Promise<ForkIdleRecoveryPauseResult> {
  const { paused } = readIdleRecoverySettings(readSettings())
  return {
    chatId: request.chatId,
    paused: paused.includes(request.chatId),
    pausedCount: paused.length,
    saved: false
  }
}

export async function readIdleRecoveryStatus(): Promise<ForkIdleRecoveryStatusResult> {
  const settings = readIdleRecoverySettings(readSettings())
  return {
    mode: settings.mode,
    running: false,
    classifier: settings.classifierCommand ? 'command' : 'builtin',
    lastSweepAt: null,
    waiting: 0,
    stalled: 0,
    paused: settings.paused
  }
}
