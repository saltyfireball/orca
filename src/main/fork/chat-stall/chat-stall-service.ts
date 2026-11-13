// Chat stall (FORK.md): the one monitor the local host's idle sweep feeds, and the hooks the
// sweep deps carry. Electron-free; the bridge subscribes to changes and runs the actions.
import type { ForkChatStallEntry } from '../../../shared/fork/chat-stall'
import {
  forkChatStallAutoRelease,
  forkChatStallMinutes,
  pickForkChatStallSettings
} from '../../../shared/fork/chat-stall'
import {
  ForkChatStallMonitor,
  type ForkChatStallCheckInput,
  type ForkChatStallDecision
} from './chat-stall-monitor'
import { judgeForkProviderTree, readForkProcessRows } from './chat-stall-probe'

export type ForkChatStallSweepHooks = {
  stall: (
    sessionId: string,
    input: ForkChatStallCheckInput | null
  ) => Promise<ForkChatStallDecision>
  attachStall: (tick: () => Promise<void>) => void
}

let monitor: ForkChatStallMonitor | null = null
let readSettings: () => unknown = () => null
const listeners = new Set<(entries: ForkChatStallEntry[]) => void>()

/** Settings as read now; a read that throws means the defaults (30 minutes, no auto release). */
function stallSettings(): { stallMs: number | null; autoRelease: boolean } {
  let settings = {}
  try {
    settings = pickForkChatStallSettings(readSettings())
  } catch {
    // Defaults below.
  }
  const minutes = forkChatStallMinutes(settings)
  return {
    stallMs: minutes === 0 ? null : minutes * 60_000,
    autoRelease: forkChatStallAutoRelease(settings)
  }
}

export function forkChatStallMonitor(): ForkChatStallMonitor {
  monitor ??= new ForkChatStallMonitor({
    now: Date.now,
    settings: stallSettings,
    probe: async (rootPid) => {
      const rows = await readForkProcessRows()
      return rows ? judgeForkProviderTree(rootPid, rows) : null
    },
    resume: (pid) => process.kill(pid, 'SIGCONT'),
    onChange: (entries) => {
      for (const listener of listeners) {
        listener(entries)
      }
    }
  })
  return monitor
}

/** Stalled chats now, without creating the monitor when no sweep ever ran (Sleepers lists them). */
export function forkChatStallEntries(): ForkChatStallEntry[] {
  return monitor ? monitor.entries() : []
}

/** The sweep deps for the local host; settings are read on every check. */
export function forkChatStallSweepHooks(settings: () => unknown): ForkChatStallSweepHooks {
  readSettings = settings
  return {
    stall: (sessionId, input) => forkChatStallMonitor().check(sessionId, input),
    attachStall: (tick) => forkChatStallMonitor().attachSweep(tick)
  }
}

/** Returns an unsubscribe. */
export function onForkChatStallChanged(listener: (entries: ForkChatStallEntry[]) => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
