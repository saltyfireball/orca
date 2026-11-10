// SLRM-1966 regression: John's "MISC" workspace, copied from his persisted workspace session.
// A chat-only worktree (no terminal tabs) with two native Claude chat tabs: "Weekly plan..."
// (teal dot, finished a day ago) and "Claude Chat" (red dot, never sent a prompt). The done
// chat's row stayed plain because the resolver only looked at chat tabs while the status entry
// carried `structuredHostOwned`, which drops once the provider child is released.
import { describe, expect, it } from 'vitest'
import type { Tab } from '../../../../shared/tab-types'
import type { AgentStatusEntry } from '../../../../shared/agent-status/contracts/agent-status-types'
import type { TerminalTab } from '../../../../shared/workspace-layout/terminal-tab-types'
import { structuredAgentSessionPaneKey } from '../../../../shared/agent-session/view/structured-agent-session-projection'
import { buildWorktreeAgentRows } from '@/components/sidebar/workspace-card/activity/worktree-agent-rows'
import { agentRowTintStyle, resolveAgentRowTabColor } from './agent-row-tab-tint'

const MISC = '99f0ec60-011d-4463-8f37-d61fc1975b4e::/Users/johnny/orca/workspaces/dotfiles/MISC'
const GROUP = '7a832ade-6d64-4c74-960b-33305d47280b'
const TEAL = '#14b8a6'
const RED = '#ef4444'

const weeklyPlan: Tab = {
  id: 'structured-agent-session-claude_dbf60262_828d_4d54_a88a_2d8a8a23dde7',
  entityId: 'claude_dbf60262_828d_4d54_a88a_2d8a8a23dde7',
  groupId: GROUP,
  worktreeId: MISC,
  executionHostId: 'local',
  contentType: 'agent-session',
  agentSessionAgent: 'claude',
  label: 'Weekly plan usage spike investigation',
  customLabel: null,
  color: TEAL,
  sortOrder: 0,
  createdAt: 1794076810712,
  lastFocusedAt: 1794353097333,
  isPinned: false
}

const claudeChat: Tab = {
  id: 'structured-agent-session-claude_f5eceff4_0d30_415c_a1b0_7f0e7e1459bd',
  entityId: 'claude_f5eceff4_0d30_415c_a1b0_7f0e7e1459bd',
  groupId: GROUP,
  worktreeId: MISC,
  executionHostId: 'local',
  contentType: 'agent-session',
  agentSessionAgent: 'claude',
  label: 'Claude Chat',
  customLabel: null,
  color: RED,
  sortOrder: 1,
  createdAt: 1794288894714,
  isPinned: false
}

const unifiedTabsByWorktree: Record<string, Tab[]> = { [MISC]: [weeklyPlan, claudeChat] }
// The persisted `tabsByWorktree` entry for MISC is an empty list: chats are not terminal tabs.
const tabsByWorktree: Record<string, TerminalTab[]> = { [MISC]: [] }
const weeklyPlanPaneKey = structuredAgentSessionPaneKey(weeklyPlan.id, weeklyPlan.entityId)

/** What structured-agent-session-status-projection writes for the chat once its turn settled. */
function weeklyPlanEntry(overrides?: Partial<AgentStatusEntry>): AgentStatusEntry {
  return {
    paneKey: weeklyPlanPaneKey,
    state: 'done',
    stateStartedAt: 1794200351504,
    updatedAt: 1794200351504,
    stateHistory: [],
    prompt: 'How do I get the claim cards down efficiently overnight?',
    agentType: 'claude',
    terminalTitle: weeklyPlan.label,
    interrupted: false,
    tabId: weeklyPlan.id,
    worktreeId: MISC,
    terminalResumeEligible: false,
    ...overrides
  }
}

function rowColor(entry: AgentStatusEntry): string | null {
  const rows = buildWorktreeAgentRows({
    tabs: tabsByWorktree[MISC] ?? [],
    representedTabs: new Map([[weeklyPlanPaneKey, weeklyPlan]]),
    entries: [entry],
    retained: [],
    now: 1794353100000
  })
  expect(rows).toHaveLength(1)
  const [row] = rows
  expect(row.paneKey).toBe(weeklyPlanPaneKey)
  expect(row.tab.id).toBe(weeklyPlan.id)
  return resolveAgentRowTabColor({
    worktreeId: row.tab.worktreeId,
    tabId: row.tab.id,
    paneKey: row.paneKey,
    tabsByWorktree,
    unifiedTabsByWorktree
  })
}

describe('SLRM-1966 MISC regression', () => {
  it('tints the done chat row teal after its provider child was released', () => {
    const entry = weeklyPlanEntry()
    expect(entry.structuredHostOwned).toBeUndefined()
    const color = rowColor(entry)
    expect(color).toBe(TEAL)
    expect(agentRowTintStyle(color)?.boxShadow).toBe(`inset 2px 0 0 ${TEAL}`)
  })

  it('tints the same row teal while the chat is still running on this host', () => {
    expect(rowColor(weeklyPlanEntry({ state: 'working', structuredHostOwned: true }))).toBe(TEAL)
  })

  it('never borrows the neighbouring red "Claude Chat" tab color', () => {
    expect(rowColor(weeklyPlanEntry())).not.toBe(RED)
  })
})
