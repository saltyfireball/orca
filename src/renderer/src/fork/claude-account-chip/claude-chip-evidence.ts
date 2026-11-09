// SLRM-1503: what the store says about where each Claude session runs, and which folder it uses.
// Terminal panes report their transcript path through agent hooks, the same evidence the
// account switch uses (claude-session-account-move.ts); native chats are asked through the fork RPC.
import type { AppState } from '@/store/types'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import { normalizeAgentProviderSession } from '../../../../shared/agent-session/lifecycle/agent-session-resume'
import { structuredAgentSessionPaneKey } from '../../../../shared/agent-session/view/structured-agent-session-projection'
import { isTerminalLeafId, makePaneKey } from '../../../../shared/workspace-layout/stable-pane-id'
import { getExecutionHostIdForWorktree } from '@/lib/workspace/ownership/worktree-runtime-owner'
import { runtimeRpcTargetForAuthorityKey } from '@/runtime/rpc/targets/runtime-client-target'
import { resolveAccountOwner } from '@/runtime/provider-accounts/ownership/wsl-host-account-owner'

/** One Claude session, as the chip resolves it. Plain data so a selector can compare it as text. */
export type ClaudeChipEvidence = {
  /** Where the session runs: RPCs for it go here. */
  transport: RuntimeClientTarget
  /** Who owns that host's Claude accounts (this desktop for a WSL host's distro). */
  ownerTarget: RuntimeClientTarget
  wslHostDistro: string | null
  /** The host's name when it is not this desktop. */
  hostLabel: string | null
  transcriptPath?: string
  chatSessionId?: string
  /** The chat's status row state; a queued move is read again when it changes. */
  chatStatus?: string
}

type SessionHost = Pick<
  ClaudeChipEvidence,
  'transport' | 'ownerTarget' | 'wslHostDistro' | 'hostLabel'
>

/** Null for direct SSH: Orca manages no Claude accounts there, so the chip names none. */
function sessionHost(
  state: AppState,
  worktreeId: string,
  executionHostId: ExecutionHostId | undefined
): SessionHost | null {
  const transport = runtimeRpcTargetForAuthorityKey(
    executionHostId ?? getExecutionHostIdForWorktree(state, worktreeId)
  )
  if (!transport) {
    return null
  }
  const owner = resolveAccountOwner(transport, state.runtimeEnvironments)
  const hostLabel =
    transport.kind === 'environment'
      ? (state.runtimeEnvironments.find((environment) => environment.id === transport.environmentId)
          ?.name ?? transport.environmentId)
      : null
  return {
    transport,
    ownerTarget: owner.target,
    wslHostDistro: owner.wslHostDistro,
    hostLabel
  }
}

function unifiedTabs(state: AppState, worktreeId: string) {
  return state.unifiedTabsByWorktree?.[worktreeId] ?? []
}

function terminalTabHostId(
  state: AppState,
  worktreeId: string,
  tabId: string
): ExecutionHostId | undefined {
  return unifiedTabs(state, worktreeId).find(
    (tab) => tab.contentType === 'terminal' && tab.entityId === tabId
  )?.executionHostId
}

/** A terminal pane running Claude, once its hooks reported a transcript. */
export function paneEvidence(
  state: AppState,
  worktreeId: string,
  tabId: string,
  paneKey: string
): ClaudeChipEvidence | null {
  const entry = state.agentStatusByPaneKey[paneKey]
  if (entry?.agentType !== 'claude' || entry.structuredHostOwned) {
    return null
  }
  const transcriptPath = normalizeAgentProviderSession(entry.providerSession)?.transcriptPath
  const host = transcriptPath
    ? sessionHost(state, worktreeId, terminalTabHostId(state, worktreeId, tabId))
    : null
  return host && transcriptPath ? { ...host, transcriptPath } : null
}

/** Every Claude pane of one terminal tab, split panes included. */
export function terminalTabEvidence(
  state: AppState,
  worktreeId: string,
  tabId: string
): ClaudeChipEvidence[] {
  const leaves = state.terminalLayoutsByTabId[tabId]?.ptyIdsByLeafId ?? {}
  const found: ClaudeChipEvidence[] = []
  for (const [leafId, ptyId] of Object.entries(leaves)) {
    const evidence =
      ptyId && isTerminalLeafId(leafId)
        ? paneEvidence(state, worktreeId, tabId, makePaneKey(tabId, leafId))
        : null
    if (evidence) {
      found.push(evidence)
    }
  }
  return found
}

/** A native Claude chat; `unifiedTabId` picks the host the tab names when one worktree has twins. */
export function chatEvidence(
  state: AppState,
  worktreeId: string,
  sessionId: string,
  unifiedTabId?: string
): ClaudeChipEvidence | null {
  const tab = unifiedTabs(state, worktreeId).find(
    (candidate) =>
      candidate.contentType === 'agent-session' &&
      candidate.entityId === sessionId &&
      (!unifiedTabId || candidate.id === unifiedTabId)
  )
  if (tab?.agentSessionAgent !== 'claude') {
    return null
  }
  const host = sessionHost(state, worktreeId, tab.executionHostId)
  const status = state.agentStatusByPaneKey[structuredAgentSessionPaneKey(tab.id, sessionId)]
  return host
    ? { ...host, chatSessionId: sessionId, ...(status ? { chatStatus: status.state } : {}) }
    : null
}

/** Every Claude session in a worktree: terminal panes and native chats. */
export function worktreeEvidence(state: AppState, worktreeId: string): ClaudeChipEvidence[] {
  const found = (state.tabsByWorktree[worktreeId] ?? []).flatMap((tab) =>
    terminalTabEvidence(state, worktreeId, tab.id)
  )
  for (const tab of unifiedTabs(state, worktreeId)) {
    const chat =
      tab.contentType === 'agent-session'
        ? chatEvidence(state, worktreeId, tab.entityId, tab.id)
        : null
    if (chat) {
      found.push(chat)
    }
  }
  return found
}

/** An agent row: a terminal pane, or the native chat whose status row has this pane key. */
export function agentRowEvidence(
  state: AppState,
  worktreeId: string,
  tabId: string,
  paneKey: string
): ClaudeChipEvidence | null {
  const entry = state.agentStatusByPaneKey[paneKey]
  if (entry?.agentType !== 'claude') {
    return null
  }
  if (!entry.structuredHostOwned) {
    return paneEvidence(state, worktreeId, tabId, paneKey)
  }
  const chat = unifiedTabs(state, worktreeId).find(
    (tab) =>
      tab.contentType === 'agent-session' &&
      structuredAgentSessionPaneKey(tab.id, tab.entityId) === paneKey
  )
  return chat ? chatEvidence(state, worktreeId, chat.entityId, chat.id) : null
}
