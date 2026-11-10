import { describe, expect, it } from 'vitest'
import type { Tab } from '../../../../shared/tab-types'
import type { TerminalTab } from '../../../../shared/workspace-layout/terminal-tab-types'
import { structuredAgentSessionPaneKey } from '../../../../shared/agent-session/view/structured-agent-session-projection'
import {
  agentRowTintStyle,
  normalizeHexColor,
  resolveAgentRowTabColor,
  ROW_TINT_ALPHA_HEX
} from './agent-row-tab-tint'

const PINK = '#ec4899'
const YELLOW = '#eab308'

function terminalTab(id: string, color: string | null): TerminalTab {
  return {
    id,
    ptyId: null,
    worktreeId: 'wt',
    title: id,
    customTitle: null,
    color,
    sortOrder: 0,
    createdAt: 0
  }
}

function chatTab(id: string, sessionId: string, color: string | null): Tab {
  return {
    id,
    entityId: sessionId,
    worktreeId: 'wt',
    groupId: 'g',
    contentType: 'agent-session',
    label: id,
    customLabel: null,
    color,
    sortOrder: 0,
    createdAt: 0
  }
}

describe('agentRowTintStyle', () => {
  it('maps the pink tab dot to a pink wash and a full pink edge bar', () => {
    expect(agentRowTintStyle(PINK)).toEqual({
      backgroundColor: `${PINK}${ROW_TINT_ALPHA_HEX}`,
      boxShadow: `inset 2px 0 0 ${PINK}`
    })
  })

  it('maps the yellow tab dot to a yellow wash and a full yellow edge bar', () => {
    expect(agentRowTintStyle(YELLOW)).toEqual({
      backgroundColor: `${YELLOW}${ROW_TINT_ALPHA_HEX}`,
      boxShadow: `inset 2px 0 0 ${YELLOW}`
    })
  })

  it('keeps the wash low alpha', () => {
    expect(Number.parseInt(ROW_TINT_ALPHA_HEX, 16) / 255).toBeLessThan(0.2)
  })

  it('leaves the row plain when the tab has no dot', () => {
    expect(agentRowTintStyle(null)).toBeNull()
    expect(agentRowTintStyle(undefined)).toBeNull()
    expect(agentRowTintStyle('')).toBeNull()
  })

  it('leaves the row plain for anything that is not a hex color', () => {
    expect(agentRowTintStyle('pink')).toBeNull()
    expect(agentRowTintStyle('#ec489')).toBeNull()
    expect(agentRowTintStyle('#ec4899;background:red')).toBeNull()
    expect(agentRowTintStyle('url(x)')).toBeNull()
  })

  it('expands short hex so the alpha suffix stays valid', () => {
    expect(normalizeHexColor('#F0A')).toBe('#ff00aa')
    expect(agentRowTintStyle('#f0a')?.backgroundColor).toBe(`#ff00aa${ROW_TINT_ALPHA_HEX}`)
  })
})

describe('resolveAgentRowTabColor', () => {
  it('reads a terminal pane row from its terminal tab, the field the tab strip paints', () => {
    const color = resolveAgentRowTabColor({
      worktreeId: 'wt',
      tabId: 't2',
      paneKey: 't2:leaf',
      structuredHostOwned: false,
      tabsByWorktree: { wt: [terminalTab('t1', YELLOW), terminalTab('t2', PINK)] },
      unifiedTabsByWorktree: {}
    })
    expect(color).toBe(PINK)
  })

  it('reads a native chat row from the agent-session tab whose pane key it owns', () => {
    const paneKey = structuredAgentSessionPaneKey('chat-2', 'session-2')
    const color = resolveAgentRowTabColor({
      worktreeId: 'wt',
      tabId: 'backing-terminal',
      paneKey,
      structuredHostOwned: true,
      tabsByWorktree: { wt: [terminalTab('backing-terminal', YELLOW)] },
      unifiedTabsByWorktree: {
        wt: [chatTab('chat-1', 'session-1', YELLOW), chatTab('chat-2', 'session-2', PINK)]
      }
    })
    expect(color).toBe(PINK)
  })

  it('clears when the tab dot clears', () => {
    const paneKey = structuredAgentSessionPaneKey('chat-1', 'session-1')
    expect(
      resolveAgentRowTabColor({
        worktreeId: 'wt',
        tabId: 'x',
        paneKey,
        structuredHostOwned: true,
        tabsByWorktree: {},
        unifiedTabsByWorktree: { wt: [chatTab('chat-1', 'session-1', null)] }
      })
    ).toBeNull()
    expect(
      resolveAgentRowTabColor({
        worktreeId: 'wt',
        tabId: 't1',
        paneKey: 't1:leaf',
        structuredHostOwned: false,
        tabsByWorktree: { wt: [terminalTab('t1', null)] },
        unifiedTabsByWorktree: {}
      })
    ).toBeNull()
  })

  it('returns null when the tab is not in this worktree', () => {
    expect(
      resolveAgentRowTabColor({
        worktreeId: 'other',
        tabId: 't1',
        paneKey: 't1:leaf',
        structuredHostOwned: false,
        tabsByWorktree: { wt: [terminalTab('t1', PINK)] },
        unifiedTabsByWorktree: undefined
      })
    ).toBeNull()
  })
})
