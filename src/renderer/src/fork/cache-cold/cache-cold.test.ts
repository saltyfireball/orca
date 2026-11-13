import { describe, expect, it, vi } from 'vitest'
import type { Tab } from '../../../../shared/tab-types'
import { structuredAgentSessionPaneKey } from '../../../../shared/agent-session/view/structured-agent-session-projection'
import { chatSessionIdForRow } from './cache-cold-view'
import { FORK_COMPACT_COMMAND, forkCompactThenSend } from './ForkCacheColdCue'

describe('forkCompactThenSend', () => {
  it('compacts, then sends a waiting draft', async () => {
    const dispatchCommand = vi.fn(async () => ({ accepted: true }))
    const send = vi.fn()
    await expect(forkCompactThenSend({ dispatchCommand }, 'next step', send)).resolves.toBe(true)
    expect(dispatchCommand).toHaveBeenCalledWith(FORK_COMPACT_COMMAND)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('only compacts when the draft is empty', async () => {
    const send = vi.fn()
    await forkCompactThenSend({ dispatchCommand: async () => ({ accepted: true }) }, '  ', send)
    expect(send).not.toHaveBeenCalled()
  })

  it('leaves the draft alone when the compaction is refused', async () => {
    const send = vi.fn()
    const result = await forkCompactThenSend(
      { dispatchCommand: async () => ({ accepted: false }) },
      'next step',
      send
    )
    expect(result).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })
})

describe('chatSessionIdForRow', () => {
  const chat = { id: 'tab-1', contentType: 'agent-session', entityId: 'session-1' } as Tab
  const terminal = { id: 'tab-2', contentType: 'terminal', entityId: 'pty-1' } as Tab

  it('finds the chat behind its own pane key only', () => {
    const paneKey = structuredAgentSessionPaneKey('tab-1', 'session-1')
    expect(chatSessionIdForRow([chat, terminal], 'tab-1', paneKey)).toBe('session-1')
    expect(chatSessionIdForRow([chat, terminal], 'tab-1', 'tab-1:other')).toBeUndefined()
    expect(chatSessionIdForRow([chat, terminal], 'tab-2', 'tab-2:1')).toBeUndefined()
    expect(chatSessionIdForRow(undefined, 'tab-1', paneKey)).toBeUndefined()
  })
})
