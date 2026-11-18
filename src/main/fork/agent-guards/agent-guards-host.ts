// Agent guards (FORK.md, SLRM-2385): what the service reads of this process and tells others: the
// rows of this host's agents, and the notify targets of a pause. Keep electron out of this file.
import { LOCAL_EXECUTION_HOST_ID } from '../../../shared/execution-host/execution-host'
import { agentGuardReasonText, type AgentGuardEntry } from '../../../shared/fork/agent-guards'
import {
  readIdleRecoverySettings,
  type IdleRecoverySettingsSource
} from '../../../shared/fork/idle-recovery-settings'
import { sleeperChatSessionId, sleeperTitle } from '../../../shared/fork/sleepers-ps-sources'
import { sendForkNotifyTargets } from '../idle-recovery/idle-recovery-notify'
import type { LimitResumeRuntime } from '../limit-resume/limit-resume-host'
import type { AgentGuardChatRow } from './agent-guards-types'

export type AgentGuardRows = {
  chats: AgentGuardChatRow[]
  live: Set<string>
  terminals: Map<string, string>
}

/** This host's native chats (with whether each works) and terminal agents' titles. */
export async function readAgentGuardRows(
  live: Pick<LimitResumeRuntime, 'getWorktreePs'>
): Promise<AgentGuardRows> {
  const chats: AgentGuardChatRow[] = []
  const ids = new Set<string>()
  const terminals = new Map<string, string>()
  for (const worktree of (await live.getWorktreePs()).worktrees) {
    // Only this host's own agents: a paired server runs its own guards.
    if (worktree.hostId && worktree.hostId !== LOCAL_EXECUTION_HOST_ID) {
      continue
    }
    for (const row of worktree.agents ?? []) {
      const title = sleeperTitle(row)
      const sessionId = sleeperChatSessionId(row.paneKey)
      if (sessionId) {
        ids.add(sessionId)
        chats.push({
          kind: 'chat',
          sessionId,
          agent: row.agentType ?? 'agent',
          title,
          worktreeId: worktree.worktreeId,
          working: row.state === 'working'
        })
      } else {
        ids.add(row.paneKey)
        terminals.set(row.paneKey, title)
      }
    }
  }
  return { chats, live: ids, terminals }
}

/** Tells the Decision inbox's notify targets (SLRM-2208) of one pause. Never throws. */
export function notifyAgentGuardPaused(
  entry: AgentGuardEntry,
  settings: IdleRecoverySettingsSource
): void {
  const targets = readIdleRecoverySettings(settings)
  const reason = agentGuardReasonText(entry)
  void sendForkNotifyTargets({
    logTag: 'agent-guards',
    desktop: targets.notifyDesktop
      ? { title: `Agent paused: ${entry.title || entry.agent}`.slice(0, 200), body: reason }
      : null,
    webhookUrl: targets.notifyWebhookUrl,
    command: targets.notifyCommand,
    payload: () =>
      JSON.stringify({
        event: 'agent-guard-paused',
        agent: {
          id: entry.id,
          kind: entry.kind,
          agent: entry.agent,
          title: entry.title.slice(0, 500),
          worktreeId: entry.worktreeId
        },
        reason: entry.reason,
        text: reason,
        ...(entry.repeats !== undefined ? { repeats: entry.repeats } : {}),
        ...(entry.spentUsd !== undefined ? { spentUsd: entry.spentUsd } : {}),
        ...(entry.capUsd !== undefined ? { capUsd: entry.capUsd } : {}),
        at: entry.since
      })
  })
}
