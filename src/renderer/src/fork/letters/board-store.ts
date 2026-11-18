// The board (FORK.md "Letters and the board", SLRM-2389): the one live copy of the open asks the
// composer trays and the Decision inbox share. It reads `window.api.forkLetters` when its first
// reader arrives, on each change event of this host, and every 30 s while a reader is mounted and
// the window is visible (asks on paired servers have no event here). With no reader it holds and
// reads nothing; with the board off nothing mounts a reader.
import { useSyncExternalStore } from 'react'
import { useAppStore } from '@/store'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import { readForkLettersSettings } from '../../../../shared/fork/letters'
import type { ForkBoardView, ForkLettersApi } from '../../../../shared/fork/letters-wire'

export type ForkBoardSnapshot = {
  view: ForkBoardView | null
  receivedAt: number
  error: string | null
}

const EMPTY: ForkBoardSnapshot = { view: null, receivedAt: 0, error: null }
const POLL_MS = 30_000

let snapshot = EMPTY
let stop: (() => void) | null = null
let generation = 0
const readers = new Set<() => void>()

export function forkLettersBridge(): ForkLettersApi | null {
  return window.api?.forkLetters ?? null
}

/** The board is on and this build has the bridge (a desktop window). */
export function useForkBoardEnabled(): boolean {
  return useAppStore((s) => readForkLettersSettings(s.settings).board) && !!forkLettersBridge()
}

export function useForkLettersEnabled(): boolean {
  return useAppStore((s) => readForkLettersSettings(s.settings).letters) && !!forkLettersBridge()
}

export function forkLettersAvailable(): boolean {
  return readForkLettersSettings(useAppStore.getState().settings).letters && !!forkLettersBridge()
}

export function forkBoardEnabled(): boolean {
  return readForkLettersSettings(useAppStore.getState().settings).board && !!forkLettersBridge()
}

function publish(next: ForkBoardSnapshot): void {
  snapshot = next
  for (const reader of readers) {
    reader()
  }
}

/** Read the board again now. A no-op with no reader or no bridge. */
export async function refreshForkBoard(): Promise<void> {
  const bridge = forkLettersBridge()
  if (!bridge || readers.size === 0) {
    return
  }
  generation += 1
  const mine = generation
  try {
    const view = await bridge.board()
    if (mine === generation) {
      publish({ view, receivedAt: Date.now(), error: null })
    }
  } catch (failure) {
    if (mine === generation) {
      publish({ ...snapshot, error: failure instanceof Error ? failure.message : String(failure) })
    }
  }
}

function subscribeLive(reader: () => void): () => void {
  readers.add(reader)
  if (readers.size === 1) {
    const offChanged = forkLettersBridge()?.onChanged(() => void refreshForkBoard()) ?? null
    const offPoll = installWindowVisibilityInterval({
      run: () => void refreshForkBoard(),
      intervalMs: POLL_MS,
      slowWhileUnfocused: true
    })
    stop = () => {
      offChanged?.()
      offPoll()
    }
    void refreshForkBoard()
  }
  return () => {
    readers.delete(reader)
    if (readers.size === 0) {
      stop?.()
      stop = null
      generation += 1
      snapshot = EMPTY
    }
  }
}

function subscribeNothing(): () => void {
  return () => {}
}

/** The live board while `enabled`; the empty snapshot, with nothing read, while not. */
export function useForkBoard(enabled: boolean): ForkBoardSnapshot {
  return useSyncExternalStore(enabled ? subscribeLive : subscribeNothing, () =>
    enabled ? snapshot : EMPTY
  )
}

// The letters dialog: which chat it shows (null: every letter), or closed.
let lettersFor: { chatId: string | null; title: string } | undefined
const lettersListeners = new Set<() => void>()

function setLettersFor(next: typeof lettersFor): void {
  lettersFor = next
  for (const listener of lettersListeners) {
    listener()
  }
}

export function openForkLetters(chatId: string | null, title = ''): void {
  if (forkLettersBridge()) {
    setLettersFor({ chatId, title })
  }
}

export function closeForkLetters(): void {
  setLettersFor(undefined)
}

export function useForkLettersOpen(): typeof lettersFor {
  return useSyncExternalStore(
    (listener) => {
      lettersListeners.add(listener)
      return () => lettersListeners.delete(listener)
    },
    () => lettersFor
  )
}
