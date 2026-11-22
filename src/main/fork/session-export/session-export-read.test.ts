import { describe, expect, it } from 'vitest'
import type { AgentReadEntry } from '../../../shared/agent-conversations/agent-conversation-contracts'
import { agentReadExportEntries } from './session-export-read'

describe('agentReadExportEntries', () => {
  it('keeps turns in order and folds each message tool calls after it', () => {
    const entries: AgentReadEntry[] = [
      { kind: 'message', role: 'user', text: 'Fix it' },
      {
        kind: 'message',
        role: 'assistant',
        text: 'On it',
        tools: [{ name: 'Edit', state: 'completed' }, { name: 'Bash' }]
      },
      { kind: 'message', role: 'assistant', text: '', tools: [{ name: 'Read' }] },
      { kind: 'error', text: 'rate limited' },
      { kind: 'approval', text: 'Run rm?', pending: true }
    ]
    expect(agentReadExportEntries(entries)).toEqual([
      { role: 'user', text: 'Fix it' },
      { role: 'assistant', text: 'On it' },
      { role: 'activity', text: 'Edit -> completed' },
      { role: 'activity', text: 'Bash' },
      { role: 'activity', text: 'Read' },
      { role: 'system', text: 'Error: rate limited' }
    ])
  })
})
