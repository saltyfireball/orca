// SLRM-2230 (FORK.md "Lost work"): a workspace that is in use is never offered as safe to remove.
// The scan reads only git; what is open or running is laid over its rows here, from the facts
// the desktop window holds (the dialog) or the runtime's `worktree.ps` rows (the CLI).
import type { LostWorkItem } from './lost-work'

/** Each signal can be switched off in Settings > Blackfish > Lost work; unset signals count. */
export const LOST_WORK_USE_SIGNALS = [
  'runningAgents',
  'openChats',
  'sleepingChats',
  'liveTerminals',
  'activeWorkspace'
] as const
export type LostWorkUseSignal = (typeof LOST_WORK_USE_SIGNALS)[number]
export type LostWorkUseSignals = Record<LostWorkUseSignal, boolean>

/** What holds a workspace open. Only signals that count are set (see `countedLostWorkUse`). */
export type LostWorkUse = {
  /** An agent works or waits on the user. */
  agentRunning: boolean
  openChats: number
  /** Chats and terminal agents that sleep; their history lives with the workspace. */
  sleepingChats: number
  liveTerminals: number
  /** The workspace on screen now. */
  active: boolean
}

export function resolveLostWorkUseSignals(
  signals: Partial<LostWorkUseSignals> | undefined
): LostWorkUseSignals {
  const resolved = {} as LostWorkUseSignals
  for (const signal of LOST_WORK_USE_SIGNALS) {
    resolved[signal] = signals?.[signal] !== false
  }
  return resolved
}

/** The use the settings count, or null when nothing that counts holds the workspace. */
export function countedLostWorkUse(
  use: LostWorkUse | undefined,
  signals: LostWorkUseSignals
): LostWorkUse | null {
  if (!use) {
    return null
  }
  const counted: LostWorkUse = {
    agentRunning: signals.runningAgents && use.agentRunning,
    openChats: signals.openChats ? use.openChats : 0,
    sleepingChats: signals.sleepingChats ? use.sleepingChats : 0,
    liveTerminals: signals.liveTerminals ? use.liveTerminals : 0,
    active: signals.activeWorkspace && use.active
  }
  const inUse =
    counted.agentRunning ||
    counted.active ||
    counted.openChats + counted.sleepingChats + counted.liveTerminals > 0
  return inUse ? counted : null
}

/**
 * Marks the rows whose workspace is in use and lifts a safe one to needs-look. Rows that are not
 * in use come back as the same objects.
 */
export function annotateLostWorkUse(
  items: readonly LostWorkItem[],
  useByWorktreeId: ReadonlyMap<string, LostWorkUse>,
  signals: LostWorkUseSignals
): LostWorkItem[] {
  return items.map((item) => {
    const use = item.worktreeId
      ? countedLostWorkUse(useByWorktreeId.get(item.worktreeId), signals)
      : null
    if (!use) {
      return item
    }
    return { ...item, inUse: use, risk: item.risk === 'safe' ? 'needs-look' : item.risk }
  })
}
