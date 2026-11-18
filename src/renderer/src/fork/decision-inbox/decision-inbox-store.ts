// Decision inbox (FORK.md "Idle recovery"): the one live copy of the inbox the toolbar button and
// the dialog share. It reads `window.api.forkIdleRecovery` when its first reader arrives and
// again on each change event; nothing polls. With no reader it holds nothing and listens to
// nothing, which is the case for as long as `forkIdleSweepMode` is 'off'.
import { useSyncExternalStore } from 'react'
import { useAppStore } from '@/store'
import {
  readIdleRecoverySettings,
  type IdleRecoveryMode
} from '../../../../shared/fork/idle-recovery-settings'
import { forkAgentGuardPausedCount } from '../agent-guards/agent-guards-store'
import type {
  ForkIdleRecoveryApi,
  ForkIdleRecoveryInboxResult
} from '../../../../shared/fork/idle-recovery-wire'

export type DecisionInboxSnapshot = {
  result: ForkIdleRecoveryInboxResult | null
  /** This window's clock when `result` arrived. */
  receivedAt: number
  error: string | null
}

const EMPTY: DecisionInboxSnapshot = { result: null, receivedAt: 0, error: null }

let snapshot = EMPTY
let stopListening: (() => void) | null = null
/** Bumped on every read and on detach, so a slow reply never overwrites a newer one. */
let generation = 0
const readers = new Set<() => void>()

let open = false
const openListeners = new Set<() => void>()

export function forkIdleRecoveryBridge(): ForkIdleRecoveryApi | null {
  return window.api?.forkIdleRecovery ?? null
}

export function forkIdleRecoveryMode(): IdleRecoveryMode {
  return readIdleRecoverySettings(useAppStore.getState().settings).mode
}

export function useForkIdleRecoveryMode(): IdleRecoveryMode {
  return useAppStore((s) => readIdleRecoverySettings(s.settings).mode)
}

/** True when the inbox can be shown: the mode is not off (or an agent guard paused an agent,
 *  SLRM-2385) and this build has the bridge. */
export function forkDecisionInboxAvailable(): boolean {
  return (
    (forkIdleRecoveryMode() !== 'off' || forkAgentGuardPausedCount() > 0) &&
    forkIdleRecoveryBridge() !== null
  )
}

function publish(next: DecisionInboxSnapshot): void {
  snapshot = next
  for (const reader of readers) {
    reader()
  }
}

/** Read the inbox again now. A no-op with no reader or no bridge. */
export async function refreshForkDecisionInbox(): Promise<void> {
  const bridge = forkIdleRecoveryBridge()
  if (!bridge || readers.size === 0) {
    return
  }
  generation += 1
  const mine = generation
  try {
    const result = await bridge.inbox()
    if (mine === generation) {
      publish({ result, receivedAt: Date.now(), error: null })
    }
  } catch (failure) {
    if (mine === generation) {
      publish({
        ...snapshot,
        error: failure instanceof Error ? failure.message : String(failure)
      })
    }
  }
}

function subscribeLive(reader: () => void): () => void {
  readers.add(reader)
  if (readers.size === 1) {
    stopListening =
      forkIdleRecoveryBridge()?.onChanged(() => void refreshForkDecisionInbox()) ?? null
    void refreshForkDecisionInbox()
  }
  return () => {
    readers.delete(reader)
    if (readers.size === 0) {
      stopListening?.()
      stopListening = null
      generation += 1
      snapshot = EMPTY
    }
  }
}

function subscribeNothing(): () => void {
  return () => {}
}

/** The live inbox while `enabled`; the empty snapshot, with nothing read, while not. */
export function useForkDecisionInbox(enabled: boolean): DecisionInboxSnapshot {
  return useSyncExternalStore(enabled ? subscribeLive : subscribeNothing, () =>
    enabled ? snapshot : EMPTY
  )
}

function setOpen(next: boolean): void {
  if (open === next) {
    return
  }
  open = next
  for (const listener of openListeners) {
    listener()
  }
}

function subscribeOpen(listener: () => void): () => void {
  openListeners.add(listener)
  return () => {
    openListeners.delete(listener)
  }
}

export function openForkDecisionInbox(): void {
  if (forkDecisionInboxAvailable()) {
    setOpen(true)
  }
}

export function closeForkDecisionInbox(): void {
  setOpen(false)
}

export function useForkDecisionInboxOpen(): boolean {
  return useSyncExternalStore(subscribeOpen, () => open)
}
