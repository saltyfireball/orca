// Worker cleanup (FORK.md). A finished orchestration worker gives up its agent process, and per
// setting its tab, a while after its report is in. It takes over from the stock 2-minute
// auto-release while on, and adds guards: kept open, used again after it reported, a question or
// approval still open, a report the coordinator has not read, or work not committed or pushed.
// Off unless `forkWorkerCleanup` is true.
import type { ForkGlobalSettings } from './fork-global-settings'

export const FORK_WORKER_CLEANUP_DEFAULT_GRACE_MINUTES = 5
/** The grace choices the settings menu offers. The sweep runs every minute. */
export const FORK_WORKER_CLEANUP_GRACE_CHOICES: readonly number[] = [1, 2, 5, 10, 15, 30, 60, 120]
/** A day; a hand-edited value past it falls back to the default. */
const MAX_GRACE_MINUTES = 24 * 60

/**
 * `close`: stop the agent and close its tab or pane; Undo or the closed-tab menu brings it back.
 * `release`: a chat stops its agent and keeps its tab (the next message starts it again). A
 * terminal's agent is its pane, so a terminal worker closes in both modes.
 */
export type ForkWorkerCleanupAction = 'close' | 'release'

export const FORK_WORKER_CLEANUP_CHANNELS = {
  /** main -> renderer: one sweep's closed workers, for the Undo notice. */
  notice: 'fork:workerCleanup:notice',
  /** main -> renderer: finished workers held open by unsaved work (replaces the last list). */
  held: 'fork:workerCleanup:held',
  /** renderer -> main (invoke): undo one notice. */
  undo: 'fork:workerCleanup:undo',
  /** renderer -> main (invoke): the current held list, for a window that just loaded. */
  readHeld: 'fork:workerCleanup:readHeld'
} as const

export type ForkWorkerCleanupItem =
  | {
      kind: 'chat-closed'
      worktreeId: string
      sessionId: string
      agent: string
    }
  | {
      kind: 'chat-released'
      worktreeId: string
      sessionId: string
      paneKey: string
    }
  | { kind: 'terminal-closed'; worktreeId: string; handle: string }

export type ForkWorkerCleanupNotice = {
  id: string
  items: ForkWorkerCleanupItem[]
}

/** Why a finished worker stays open; shown as a mark on its row and tab. */
export type ForkWorkerCleanupHeldReason = 'uncommitted' | 'unpushed'

export type ForkWorkerCleanupHeld = {
  paneKey: string
  sessionId: string | null
  reason: ForkWorkerCleanupHeldReason
}

/** Undo reopens closed tabs in main; the renderer reopens chats it is handed back. */
export type ForkWorkerCleanupUndoResult = {
  reopenChats: ForkWorkerCleanupItem[]
}

export type ForkWorkerCleanupApi = {
  onNotice: (listener: (notice: ForkWorkerCleanupNotice) => void) => () => void
  onHeld: (listener: (held: ForkWorkerCleanupHeld[]) => void) => () => void
  readHeld: () => Promise<ForkWorkerCleanupHeld[]>
  undo: (noticeId: string) => Promise<ForkWorkerCleanupUndoResult>
}

type WorkerCleanupSettings = Pick<
  ForkGlobalSettings,
  | 'forkWorkerCleanup'
  | 'forkWorkerCleanupGraceMinutes'
  | 'forkWorkerCleanupAction'
  | 'forkWorkerCleanupOnDone'
  | 'forkWorkerCleanupOnMerged'
>

/** The worker cleanup fields of any settings object; a store type without fork keys still reads. */
export function pickForkWorkerCleanupSettings(value: unknown): WorkerCleanupSettings {
  if (typeof value !== 'object' || value === null) {
    return {}
  }
  const read = (key: keyof WorkerCleanupSettings): unknown =>
    key in value ? Reflect.get(value, key) : undefined
  const enabled = read('forkWorkerCleanup')
  const minutes = read('forkWorkerCleanupGraceMinutes')
  const action = read('forkWorkerCleanupAction')
  const onDone = read('forkWorkerCleanupOnDone')
  const onMerged = read('forkWorkerCleanupOnMerged')
  return {
    ...(typeof enabled === 'boolean' ? { forkWorkerCleanup: enabled } : {}),
    ...(typeof minutes === 'number' ? { forkWorkerCleanupGraceMinutes: minutes } : {}),
    ...(action === 'close' || action === 'release' ? { forkWorkerCleanupAction: action } : {}),
    ...(typeof onDone === 'boolean' ? { forkWorkerCleanupOnDone: onDone } : {}),
    ...(typeof onMerged === 'boolean' ? { forkWorkerCleanupOnMerged: onMerged } : {})
  }
}

export function forkWorkerCleanupEnabled(value: unknown): boolean {
  return pickForkWorkerCleanupSettings(value).forkWorkerCleanup === true
}

/** Whole minutes from 0 to a day; anything else reads as the default. */
export function forkWorkerCleanupGraceMinutes(value: unknown): number {
  const minutes = pickForkWorkerCleanupSettings(value).forkWorkerCleanupGraceMinutes
  return typeof minutes === 'number' &&
    Number.isInteger(minutes) &&
    minutes >= 0 &&
    minutes <= MAX_GRACE_MINUTES
    ? minutes
    : FORK_WORKER_CLEANUP_DEFAULT_GRACE_MINUTES
}

export function forkWorkerCleanupAction(value: unknown): ForkWorkerCleanupAction {
  return pickForkWorkerCleanupSettings(value).forkWorkerCleanupAction === 'release'
    ? 'release'
    : 'close'
}

/** The worker-done trigger is on unless set false. */
export function forkWorkerCleanupOnDone(value: unknown): boolean {
  return pickForkWorkerCleanupSettings(value).forkWorkerCleanupOnDone !== false
}

/** The merged trigger is off unless set true. */
export function forkWorkerCleanupOnMerged(value: unknown): boolean {
  return pickForkWorkerCleanupSettings(value).forkWorkerCleanupOnMerged === true
}
