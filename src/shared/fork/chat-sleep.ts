// Chat sleep (FORK.md). A native chat that has been idle for a while gives up its provider
// process; the tab and transcript stay, and the next message starts the provider again on the
// same session. The stock idle sweep does the release and the restart; these settings only
// choose its window and keep chats on screen awake. Off unless `forkChatSleep` is true.
import type { ForkGlobalSettings } from './fork-global-settings'

export const FORK_CHAT_SLEEP_DEFAULT_IDLE_MINUTES = 30
/** The idle choices the settings menu offers. The idle sweep runs every 5 minutes. */
export const FORK_CHAT_SLEEP_MINUTE_CHOICES: readonly number[] = [5, 10, 15, 30, 60, 120, 240, 480]
/** A week; a hand-edited value past it falls back to the default. */
const MAX_IDLE_MINUTES = 7 * 24 * 60

export const FORK_CHAT_SLEEP_CHANNELS = {
  /** renderer -> main: the native chat session ids on screen now (replaces the last list). */
  onScreen: 'fork:chatSleep:onScreen'
} as const

/** Most session ids one report may carry; more is not a real window and is cut. */
export const FORK_CHAT_SLEEP_MAX_ON_SCREEN = 256

type ChatSleepSettings = Pick<
  ForkGlobalSettings,
  'forkChatSleep' | 'forkChatSleepIdleMinutes' | 'forkChatSleepKeepVisible'
>

/** The chat sleep fields of any settings object; a store type without fork keys still reads. */
export function pickForkChatSleepSettings(value: unknown): ChatSleepSettings {
  if (typeof value !== 'object' || value === null) {
    return {}
  }
  const enabled = 'forkChatSleep' in value ? value.forkChatSleep : undefined
  const minutes = 'forkChatSleepIdleMinutes' in value ? value.forkChatSleepIdleMinutes : undefined
  const keepVisible =
    'forkChatSleepKeepVisible' in value ? value.forkChatSleepKeepVisible : undefined
  return {
    ...(typeof enabled === 'boolean' ? { forkChatSleep: enabled } : {}),
    ...(typeof minutes === 'number' ? { forkChatSleepIdleMinutes: minutes } : {}),
    ...(typeof keepVisible === 'boolean' ? { forkChatSleepKeepVisible: keepVisible } : {})
  }
}

export function forkChatSleepEnabled(settings: ChatSleepSettings | null | undefined): boolean {
  return settings?.forkChatSleep === true
}

/** Whole minutes from 1 to a week; anything else reads as the default. */
export function forkChatSleepIdleMinutes(settings: ChatSleepSettings | null | undefined): number {
  const minutes = settings?.forkChatSleepIdleMinutes
  return typeof minutes === 'number' &&
    Number.isInteger(minutes) &&
    minutes >= 1 &&
    minutes <= MAX_IDLE_MINUTES
    ? minutes
    : FORK_CHAT_SLEEP_DEFAULT_IDLE_MINUTES
}

/** Chats on screen stay awake unless this is false. */
export function forkChatSleepKeepVisible(settings: ChatSleepSettings | null | undefined): boolean {
  return settings?.forkChatSleepKeepVisible !== false
}

/** Keep only distinct, nonempty strings, at most FORK_CHAT_SLEEP_MAX_ON_SCREEN of them. */
export function normalizeForkChatSleepOnScreen(ids: unknown): string[] {
  if (!Array.isArray(ids)) {
    return []
  }
  const kept = new Set<string>()
  for (const id of ids) {
    if (kept.size >= FORK_CHAT_SLEEP_MAX_ON_SCREEN) {
      break
    }
    if (typeof id === 'string' && id.length > 0 && id.length <= 512) {
      kept.add(id)
    }
  }
  return [...kept]
}

export type ForkChatSleepApi = {
  /** Report the native chat session ids on screen now. */
  setOnScreen: (sessionIds: string[]) => void
}
