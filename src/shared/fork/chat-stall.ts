// Chat stall (FORK.md). A native chat whose turn is still open but has recorded nothing from its
// provider for a while is marked stalled on its row, with Interrupt, Release and Wake. The stock
// idle sweep treats an open turn as busy, so a turn whose end was lost, or whose provider is
// stopped or gone without its exit seen, would otherwise hold its provider forever. A stalled
// chat whose provider is alive is only marked: it may be running a long tool. With auto release
// on, a chat stalled for twice the window whose provider is stopped or gone is released.
import type { ForkGlobalSettings } from './fork-global-settings'

export const FORK_CHAT_STALL_DEFAULT_MINUTES = 30
/** The choices the settings menu offers; 0 turns detection off. The sweep runs every 5 minutes. */
export const FORK_CHAT_STALL_MINUTE_CHOICES: readonly number[] = [0, 10, 15, 30, 60, 120, 240]
/** A week; a hand-edited value past it falls back to the default. */
const MAX_STALL_MINUTES = 7 * 24 * 60

export const FORK_CHAT_STALL_CHANNELS = {
  /** renderer -> main (invoke): the stalled chats now. */
  list: 'fork:chatStall:list',
  /** main -> renderer: the stalled chats changed. */
  changed: 'fork:chatStall:changed',
  /** renderer -> main (invoke): run one action on one stalled chat. */
  act: 'fork:chatStall:act'
} as const

/**
 * What the process table says of a stalled chat's provider: `alive` (running, maybe a long tool),
 * `stopped` (in the stopped state, T), `gone` (no such process), `unknown` (could not read).
 */
export type ForkChatStallLiveness = 'alive' | 'stopped' | 'gone' | 'unknown'

export type ForkChatStallEntry = {
  sessionId: string
  /** When the chat last recorded provider output, in epoch ms. */
  quietSince: number
  liveness: ForkChatStallLiveness
}

export type ForkChatStallAction = 'interrupt' | 'release' | 'wake'

const ACTIONS: readonly ForkChatStallAction[] = ['interrupt', 'release', 'wake']

export function isForkChatStallAction(value: unknown): value is ForkChatStallAction {
  return ACTIONS.some((action) => action === value)
}

type ChatStallSettings = Pick<
  ForkGlobalSettings,
  'forkChatStallMinutes' | 'forkChatStallAutoRelease'
>

/** The chat stall fields of any settings object; a store type without fork keys still reads. */
export function pickForkChatStallSettings(value: unknown): ChatStallSettings {
  if (typeof value !== 'object' || value === null) {
    return {}
  }
  const minutes = 'forkChatStallMinutes' in value ? value.forkChatStallMinutes : undefined
  const auto = 'forkChatStallAutoRelease' in value ? value.forkChatStallAutoRelease : undefined
  return {
    ...(typeof minutes === 'number' ? { forkChatStallMinutes: minutes } : {}),
    ...(typeof auto === 'boolean' ? { forkChatStallAutoRelease: auto } : {})
  }
}

/** Whole minutes from 1 to a week, 0 for off; anything else reads as the default. */
export function forkChatStallMinutes(settings: ChatStallSettings | null | undefined): number {
  const minutes = settings?.forkChatStallMinutes
  return typeof minutes === 'number' &&
    Number.isInteger(minutes) &&
    minutes >= 0 &&
    minutes <= MAX_STALL_MINUTES
    ? minutes
    : FORK_CHAT_STALL_DEFAULT_MINUTES
}

export function forkChatStallAutoRelease(settings: ChatStallSettings | null | undefined): boolean {
  return settings?.forkChatStallAutoRelease === true
}

/** Entries as main sends them; anything malformed is dropped. */
export function normalizeForkChatStallEntries(value: unknown): ForkChatStallEntry[] {
  if (!Array.isArray(value)) {
    return []
  }
  const liveness: readonly ForkChatStallLiveness[] = ['alive', 'stopped', 'gone', 'unknown']
  return value.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) {
      return []
    }
    const { sessionId, quietSince, liveness: state } = entry as Record<string, unknown>
    return typeof sessionId === 'string' &&
      typeof quietSince === 'number' &&
      liveness.some((known) => known === state)
      ? [{ sessionId, quietSince, liveness: state as ForkChatStallLiveness }]
      : []
  })
}

export type ForkChatStallApi = {
  list: () => Promise<unknown>
  /** Returns an unsubscribe. */
  onChanged: (listener: (entries: unknown) => void) => () => void
  act: (sessionId: string, action: ForkChatStallAction) => Promise<boolean>
}
