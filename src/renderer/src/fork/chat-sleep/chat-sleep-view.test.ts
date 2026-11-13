import { describe, expect, it } from 'vitest'
import type { Tab, TabGroup } from '../../../../shared/tab-types'
import { structuredAgentSessionPaneKey } from '../../../../shared/agent-session/view/structured-agent-session-projection'
import {
  chatPaneKeyForSession,
  isChatPaneKey,
  isSleepingChatStatus,
  onScreenChatSessionIds
} from './chat-sleep-view'

function tab(id: string, contentType: Tab['contentType'], entityId: string, groupId = 'g1'): Tab {
  return { id, entityId, groupId, worktreeId: 'wt', contentType, label: id } as Tab
}

function group(id: string, activeTabId: string | null): TabGroup {
  return { id, worktreeId: 'wt', activeTabId, tabOrder: [] } as TabGroup
}

const tabs = [
  tab('t-chat-1', 'agent-session', 'session-1'),
  tab('t-chat-2', 'agent-session', 'session-2', 'g2'),
  tab('t-term', 'terminal', 'pty-1', 'g2')
]

describe('onScreenChatSessionIds', () => {
  it('lists the active chat tab of each group in the open workspace, sorted', () => {
    expect(
      onScreenChatSessionIds({
        activeWorktreeId: 'wt',
        groupsByWorktree: { wt: [group('g2', 't-chat-2'), group('g1', 't-chat-1')] },
        unifiedTabsByWorktree: { wt: tabs }
      })
    ).toEqual(['session-1', 'session-2'])
  })

  it('skips groups showing a terminal or nothing, and other workspaces', () => {
    expect(
      onScreenChatSessionIds({
        activeWorktreeId: 'wt',
        groupsByWorktree: { wt: [group('g1', null), group('g2', 't-term')] },
        unifiedTabsByWorktree: { wt: tabs }
      })
    ).toEqual([])
    expect(
      onScreenChatSessionIds({
        activeWorktreeId: null,
        groupsByWorktree: { wt: [group('g1', 't-chat-1')] },
        unifiedTabsByWorktree: { wt: tabs }
      })
    ).toEqual([])
  })
})

describe('chat pane keys', () => {
  const key = structuredAgentSessionPaneKey('t-chat-1', 'session-1')

  it('finds a chat tab pane key by session id', () => {
    expect(chatPaneKeyForSession(tabs, 'session-1')).toBe(key)
    expect(chatPaneKeyForSession(tabs, 'pty-1')).toBeNull()
  })

  it('tells chat pane keys from terminal ones', () => {
    expect(isChatPaneKey(tabs, key)).toBe(true)
    expect(isChatPaneKey(tabs, 't-term:pane-1')).toBe(false)
    expect(isChatPaneKey(undefined, key)).toBe(false)
  })
})

describe('isSleepingChatStatus', () => {
  it('is a settled chat with no provider running', () => {
    expect(isSleepingChatStatus({ state: 'done' })).toBe(true)
    expect(isSleepingChatStatus({ state: 'done', structuredHostOwned: true })).toBe(false)
    expect(isSleepingChatStatus({ state: 'working' })).toBe(false)
    expect(isSleepingChatStatus({ state: 'blocked' })).toBe(false)
    expect(isSleepingChatStatus({ state: 'waiting' })).toBe(false)
    expect(isSleepingChatStatus(undefined)).toBe(false)
  })
})
