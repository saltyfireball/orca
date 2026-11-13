// Sleepers (FORK.md): the dialog's actions. List, sleep and pin go to this desktop's host through
// the fork.sleepers.* RPC; wake and close are the stock gestures (open the agent's pane, close
// its tab), so they behave exactly as the sidebar does.
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { activateWorktreeAgentPane } from '@/components/sidebar/workspace-card/activity/use-worktree-agent-activation'
import { parsePaneKey } from '../../../../shared/workspace-layout/stable-pane-id'
import type { SleeperRow } from '../../../../shared/fork/sleepers'
import type {
  ForkSleepOutcome,
  ForkSleepersListResult,
  ForkSleepersPinResult,
  ForkSleepersSleepResult
} from '../../../../shared/fork/sleepers-wire'

const LOCAL = { kind: 'local' } as const

export function fetchSleepers(): Promise<ForkSleepersListResult> {
  return callRuntimeRpc<ForkSleepersListResult>(LOCAL, 'fork.sleepers.list', {})
}

/** Counts of what a sleep request did, for one toast. */
export function summarizeSleepOutcomes(outcomes: readonly ForkSleepOutcome[]): {
  slept: number
  busy: number
  other: number
} {
  let slept = 0
  let busy = 0
  for (const outcome of outcomes) {
    if (outcome.result === 'asleep') {
      slept += 1
    } else if (outcome.result === 'busy') {
      busy += 1
    }
  }
  return { slept, busy, other: outcomes.length - slept - busy }
}

export async function sleepSleepers(sessionIds: readonly string[]): Promise<void> {
  if (sessionIds.length === 0) {
    toast.message(translate('fork.sleepers.toast.nothing', 'No idle chats to put to sleep.'))
    return
  }
  try {
    const { outcomes } = await callRuntimeRpc<ForkSleepersSleepResult>(
      LOCAL,
      'fork.sleepers.sleep',
      { sessionIds: [...sessionIds] }
    )
    const { slept, busy } = summarizeSleepOutcomes(outcomes)
    const parts = [
      translate('fork.sleepers.toast.slept', '{{count}} put to sleep', { count: slept }),
      ...(busy > 0
        ? [translate('fork.sleepers.toast.busy', '{{count}} busy, left awake', { count: busy })]
        : [])
    ]
    toast.success(parts.join(', '))
  } catch (error) {
    toast.error(translate('fork.sleepers.toast.failed', 'Could not put chats to sleep.'), {
      description: error instanceof Error ? error.message : String(error)
    })
  }
}

export async function setSleeperPinned(row: SleeperRow, pinned: boolean): Promise<void> {
  try {
    await callRuntimeRpc<ForkSleepersPinResult>(LOCAL, 'fork.sleepers.pin', {
      sessionId: row.id,
      pinned
    })
  } catch (error) {
    toast.error(translate('fork.sleepers.toast.pinFailed', 'Could not change the pin.'), {
      description: error instanceof Error ? error.message : String(error)
    })
  }
}

/** Open the agent's pane the way its sidebar row does; a chat's provider starts on the next send. */
export function wakeSleeper(row: SleeperRow): boolean {
  const parsed = parsePaneKey(row.paneKey)
  if (!row.worktreeId || !parsed) {
    return false
  }
  activateWorktreeAgentPane(row.worktreeId, parsed.tabId, row.paneKey)
  return true
}

/** Close the agent's tab, as its tab's close button does. */
export function closeSleeper(row: SleeperRow): boolean {
  const parsed = parsePaneKey(row.paneKey)
  if (!row.worktreeId || !parsed) {
    return false
  }
  const state = useAppStore.getState()
  const tab = (state.unifiedTabsByWorktree[row.worktreeId] ?? []).find(
    (candidate) => candidate.id === parsed.tabId || candidate.entityId === parsed.tabId
  )
  if (!tab) {
    return false
  }
  return state.closeUnifiedTab(tab.id) !== null
}
