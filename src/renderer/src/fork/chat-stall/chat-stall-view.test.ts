import { describe, expect, it } from 'vitest'
import type { Tab } from '../../../../shared/tab-types'
import { structuredAgentSessionPaneKey } from '../../../../shared/agent-session/view/structured-agent-session-projection'
import { chatSessionIdForPaneKey, chatStallCanWake, chatStallQuietMinutes } from './chat-stall-view'

function tab(id: string, contentType: Tab['contentType'], entityId: string): Tab {
  return { id, entityId, groupId: 'g1', worktreeId: 'wt', contentType, label: id } as Tab
}

const tabs = [tab('t-chat', 'agent-session', 'session-1'), tab('t-term', 'terminal', 'pty-1')]

describe('chatSessionIdForPaneKey', () => {
  it('finds the chat of a chat row', () => {
    const key = structuredAgentSessionPaneKey('t-chat', 'session-1')
    expect(chatSessionIdForPaneKey(tabs, key)).toBe('session-1')
  })

  it('is null for a terminal row or an unknown key', () => {
    expect(chatSessionIdForPaneKey(tabs, 't-term:1')).toBeNull()
    expect(chatSessionIdForPaneKey(tabs, 't-chat:other')).toBeNull()
    expect(chatSessionIdForPaneKey(undefined, 'x')).toBeNull()
  })
})

describe('chat stall labels', () => {
  const entry = { sessionId: 's', quietSince: 0, liveness: 'stopped' as const }

  it('counts whole quiet minutes, never negative', () => {
    expect(chatStallQuietMinutes(entry, 31 * 60_000 + 59_000)).toBe(31)
    expect(chatStallQuietMinutes(entry, -5)).toBe(0)
  })

  it('offers Wake only for a stopped provider', () => {
    expect(chatStallCanWake(entry)).toBe(true)
    expect(chatStallCanWake({ ...entry, liveness: 'alive' })).toBe(false)
  })
})
