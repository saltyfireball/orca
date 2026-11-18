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
import {
  forkAgentGuardPausedCount,
  useForkAgentGuardPausedCount
} from '../agent-guards/agent-guards-store'
import { readPrBabysitSettings } from '../../../../shared/fork/pr-babysit'
import type {
  ForkIdleRecoveryApi,
  ForkIdleRecoveryInboxResult
} from '../../../../shared/fork/idle-recovery-wire'
import { forkBoardEnabled } from '../letters/board-store'

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

type InboxSettings = Parameters<typeof readIdleRecoverySettings>[0] &
  Parameters<typeof readPrBabysitSettings>[0]

/** The inbox is on while idle recovery is, or while the PR babysitter has a repo (SLRM-2386). */
export function forkDecisionInboxOn(settings: InboxSettings): boolean {
  return (
    readIdleRecoverySettings(settings).mode !== 'off' ||
    readPrBabysitSettings(settings).repos.length > 0
  )
}

/** On as above, or while an agent guard holds an agent paused (SLRM-2385). */
export function useForkDecisionInboxOn(): boolean {
  const on = useAppStore((s) => forkDecisionInboxOn(s.settings as InboxSettings))
  return useForkAgentGuardPausedCount() > 0 || on
}

/**
 * True when the inbox can be shown: it is on and this build has the bridge, or the board is on
 * (SLRM-2389: its asks are listed here too).
 */
export function forkDecisionInboxAvailable(): boolean {
  return (
    ((forkDecisionInboxOn(useAppStore.getState().settings as InboxSettings) ||
      forkAgentGuardPausedCount() > 0) &&
      forkIdleRecoveryBridge() !== null) ||
    forkBoardEnabled()
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
