// Idle recovery (FORK.md), item B: invented agent rows, journals and a fake host for the tests.
import type { AgentJournalRenderItem } from '../../../shared/agent-session/journal/agent-session-journal-types'
import {
  readIdleRecoverySettings,
  type IdleRecoverySettings
} from '../../../shared/fork/idle-recovery-settings'
import type { RuntimeWorktreeAgentRow } from '../../../shared/runtime-worktree-contracts'
import type { IdleRecoveryHost, IdleRecoveryPsWorktree } from './idle-recovery-host'

export const NOW = 1_700_000_000_000

export function settingsFor(overrides: Partial<IdleRecoverySettings> = {}): IdleRecoverySettings {
  return { ...readIdleRecoverySettings(undefined), mode: 'inbox', idleSeconds: 60, ...overrides }
}

export function agentRow(
  overrides: Partial<RuntimeWorktreeAgentRow> = {}
): RuntimeWorktreeAgentRow {
  return {
    paneKey: 'tab-1:leaf-1',
    parentPaneKey: null,
    state: 'done',
    agentType: 'claude',
    prompt: 'tidy the changelog',
    taskTitle: null,
    displayName: null,
    lastAssistantMessage: null,
    toolName: null,
    toolInput: null,
    interrupted: false,
    stateStartedAt: NOW - 120_000,
    updatedAt: NOW - 120_000,
    hasLivePty: true,
    ...overrides
  }
}

export function psWorktree(
  agents: RuntimeWorktreeAgentRow[],
  overrides: Partial<IdleRecoveryPsWorktree> = {}
): IdleRecoveryPsWorktree {
  return {
    worktreeId: 'wt-1',
    displayName: 'garden',
    repo: 'garden',
    path: '/invented/garden',
    agents,
    ...overrides
  }
}

export function fakeHost(
  worktrees: IdleRecoveryPsWorktree[],
  overrides: Partial<IdleRecoveryHost> = {}
): IdleRecoveryHost {
  return {
    worktreePs: async () => worktrees,
    chatFacts: () => new Map(),
    lifecycle: () => ({}),
    chatSummary: () => null,
    chatJournal: async () => null,
    terminalStatus: async () => null,
    dispatchRows: async () => [],
    ...overrides
  }
}

let sequence = 0

export function journalMessage(
  role: 'user' | 'assistant' | 'reasoning',
  text: string,
  overrides: Partial<AgentJournalRenderItem> = {},
  body: Record<string, unknown> = {}
): AgentJournalRenderItem {
  sequence += 1
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a test row with only the fields the reader looks at.
  return {
    itemId: `item-${sequence}`,
    revision: 1,
    sequence,
    observedAt: NOW,
    body: { kind: 'message', role, blocks: [{ type: 'text', text }], ...body },
    ...overrides
  } as AgentJournalRenderItem
}
