// SLRM-2230 (FORK.md "Lost work"): which workspaces are in use, from what the window already
// tracks: the sidebar's live agents, open chat tabs, sleeping chats and agents, terminals with a
// live PTY, and the workspace on screen. Nothing is tracked here.
import type { AppState } from '@/store/types'
import { getLiveAgentStatusByWorktreeId } from '@/lib/workspace/activity/worktree-activity-state'
import { isPaneSleepRecord } from '../../../../shared/agent-session/lifecycle/agent-session-resume'
import { structuredAgentSessionPaneKey } from '../../../../shared/agent-session/view/structured-agent-session-projection'
import { isStructuredTab } from '../../../../shared/agent-session/view/structured-agent-session-tab'
import type { LostWorkUse } from '../../../../shared/fork/lost-work-use'
import { isSleepingChatStatus } from '../chat-sleep/chat-sleep-view'

export type LostWorkUseFacts = Pick<
  AppState,
  | 'activeWorktreeId'
  | 'tabsByWorktree'
  | 'unifiedTabsByWorktree'
  | 'ptyIdsByTabId'
  | 'agentStatusByPaneKey'
  | 'sleepingAgentSessionsByPaneKey'
>

/** The use of each of `worktreeIds` that has any; a workspace nothing holds is left out. */
export function lostWorkUseByWorktree(
  facts: LostWorkUseFacts,
  worktreeIds: Iterable<string>,
  now: number
): Map<string, LostWorkUse> {
  const live = getLiveAgentStatusByWorktreeId(facts.agentStatusByPaneKey, facts.tabsByWorktree, now)
  const slept = new Map<string, number>()
  for (const record of Object.values(facts.sleepingAgentSessionsByPaneKey ?? {})) {
    if (isPaneSleepRecord(record)) {
      slept.set(record.worktreeId, (slept.get(record.worktreeId) ?? 0) + 1)
    }
  }
  const uses = new Map<string, LostWorkUse>()
  for (const worktreeId of new Set(worktreeIds)) {
    let openChats = 0
    let sleepingChats = slept.get(worktreeId) ?? 0
    for (const tab of facts.unifiedTabsByWorktree?.[worktreeId] ?? []) {
      if (!isStructuredTab(tab)) {
        continue
      }
      const paneKey = structuredAgentSessionPaneKey(tab.id, tab.entityId)
      if (isSleepingChatStatus(facts.agentStatusByPaneKey?.get(paneKey))) {
        sleepingChats += 1
      } else {
        openChats += 1
      }
    }
    const liveTerminals = (facts.tabsByWorktree?.[worktreeId] ?? []).filter(
      (tab) => (facts.ptyIdsByTabId?.[tab.id]?.length ?? 0) > 0
    ).length
    const use: LostWorkUse = {
      agentRunning: live.has(worktreeId),
      openChats,
      sleepingChats,
      liveTerminals,
      active: facts.activeWorktreeId === worktreeId
    }
    if (use.agentRunning || use.active || openChats + sleepingChats + liveTerminals > 0) {
      uses.set(worktreeId, use)
    }
  }
  return uses
}
