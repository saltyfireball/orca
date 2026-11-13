// Chat sleep (FORK.md) rides the stock native chat idle sweep, which already releases an idle
// chat's provider (stop, then close the conversation at rest) and starts it again on the next
// send. While `forkChatSleep` is on, this supplies the sweep's window and a keep-awake check for
// chats on screen; while it is off, the sweep runs on the stock window and nothing is kept awake.
// The sweep's own owed-work check (a turn, queued or mid-delivery sends, open dispatches,
// prompts, child work, a provider that is not confirmed idle) still runs first, so a busy chat is
// never put to sleep.
import type { ForkGlobalSettings } from '../../../shared/fork/fork-global-settings'
import {
  forkChatSleepEnabled,
  forkChatSleepIdleMinutes,
  forkChatSleepKeepVisible,
  normalizeForkChatSleepOnScreen,
  pickForkChatSleepSettings
} from '../../../shared/fork/chat-sleep'
import { readForkSleepersPinned } from '../../../shared/fork/sleepers'
import {
  attachForkSleepersSweep,
  type ForkSleepersSweep
} from '../sleepers/sleepers-sweep-registry'

/** On-screen session ids per reporting window, so a closed window drops only its own. */
const onScreenBySource = new Map<number, ReadonlySet<string>>()

/** Replace one window's on-screen list. Bad input reads as an empty list. */
export function setForkChatSleepOnScreen(sourceId: number, ids: unknown): void {
  const list = normalizeForkChatSleepOnScreen(ids)
  if (list.length === 0) {
    onScreenBySource.delete(sourceId)
    return
  }
  onScreenBySource.set(sourceId, new Set(list))
}

/** Forget a window that closed or reloaded. */
export function clearForkChatSleepOnScreen(sourceId: number): void {
  onScreenBySource.delete(sourceId)
}

export function isForkChatOnScreen(sessionId: string): boolean {
  for (const ids of onScreenBySource.values()) {
    if (ids.has(sessionId)) {
      return true
    }
  }
  return false
}

/** Test seam: forget every report. */
export function resetForkChatSleepOnScreen(): void {
  onScreenBySource.clear()
}

/** Sleepers (FORK.md): a pinned chat never sleeps on idle, whether or not chat sleep is on. */
function pinned(readSettings: () => unknown, sessionId: string): boolean {
  try {
    return readForkSleepersPinned(readSettings()).includes(sessionId)
  } catch {
    return false
  }
}

export type ForkChatSleepIdleSweep = {
  idleMs: () => number | null
  keepAwake: (sessionId: string) => boolean
  attach: (sweep: ForkSleepersSweep) => void
}

/**
 * The idle sweep deps for the local host. Both reads happen on every sweep tick, so a settings
 * change applies without a restart. A settings read that throws keeps the stock behavior.
 */
export function forkChatSleepIdleSweep(
  readSettings: () => unknown,
  stockIdleMs: () => number | null
): ForkChatSleepIdleSweep {
  const enabledSettings = (): ForkGlobalSettings | null => {
    try {
      const settings = pickForkChatSleepSettings(readSettings())
      return forkChatSleepEnabled(settings) ? settings : null
    } catch {
      return null
    }
  }
  return {
    idleMs: () => {
      const settings = enabledSettings()
      return settings ? forkChatSleepIdleMinutes(settings) * 60_000 : stockIdleMs()
    },
    keepAwake: (sessionId) => {
      if (pinned(readSettings, sessionId)) {
        return true
      }
      const settings = enabledSettings()
      return (
        settings !== null && forkChatSleepKeepVisible(settings) && isForkChatOnScreen(sessionId)
      )
    },
    attach: attachForkSleepersSweep
  }
}
