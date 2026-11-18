import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeClient } from '../runtime/client'
import {
  FORK_CHAT_HANDOFF_HANDLERS,
  formatChatHandoff,
  formatChatHistory
} from './chat-handoff-handlers'

function client(result: unknown, isRemote = false) {
  const runtime = new RuntimeClient('/tmp/orca-chat-handoff-test', 60_000, null, null)
  vi.spyOn(runtime, 'isRemote', 'get').mockReturnValue(isRemote)
  const call = vi.fn().mockResolvedValue({ id: 'r', ok: true, result, _meta: { runtimeId: 'x' } })
  vi.spyOn(runtime, 'call').mockImplementation(call)
  return { runtime, call }
}

const started = {
  status: 'started' as const,
  mode: 'new' as const,
  sessionId: 'chat-codex-00001',
  agent: 'codex' as const,
  name: 'Fix the login (Codex)',
  entries: 12,
  omittedOlder: true,
  historyTokens: 15_000,
  budgetTokens: 16_000,
  stoppedSource: false,
  cancelledLimitResume: true
}

describe('orca chat handoff', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('sends the chat, the agent and the flags given', async () => {
    const { runtime, call } = client(started)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await FORK_CHAT_HANDOFF_HANDLERS['chat handoff']({
      flags: new Map<string, string | boolean>([
        ['id', 'chat-claude-0001'],
        ['to', 'codex'],
        ['message', 'finish it'],
        ['stop', true],
        ['dry-run', true]
      ]),
      client: runtime,
      cwd: '/tmp',
      json: true
    })
    expect(call).toHaveBeenCalledWith('fork.chatHandoff.start', {
      sessionId: 'chat-claude-0001',
      to: 'codex',
      request: 'finish it',
      stop: true,
      dryRun: true
    })
  })

  it('takes the chat it runs in, but never on a paired host', async () => {
    vi.stubEnv('ORCA_AGENT_SESSION_ID', 'chat-claude-0001')
    const remote = client(started, true)
    await expect(
      FORK_CHAT_HANDOFF_HANDLERS['chat handoff']({
        flags: new Map([['to', 'codex']]),
        client: remote.runtime,
        cwd: '/tmp',
        json: true
      })
    ).rejects.toThrow('Name the chat by its session id')
    expect(remote.call).not.toHaveBeenCalled()
  })

  it('refuses an agent it does not know', async () => {
    const { runtime } = client(started)
    await expect(
      FORK_CHAT_HANDOFF_HANDLERS['chat handoff']({
        flags: new Map([
          ['id', 'chat-claude-0001'],
          ['to', 'gemini']
        ]),
        client: runtime,
        cwd: '/tmp',
        json: true
      })
    ).rejects.toThrow('--to takes codex or claude')
  })

  it('says what was carried and what happened to the source', () => {
    const text = formatChatHandoff(started)
    expect(text).toContain('Started "Fix the login (Codex)" on Codex (chat-codex-00001)')
    expect(text).toContain(
      '12 entries (15000 of 16000 tokens), older ones left to orca chat history'
    )
    expect(text).toContain('will not resume at its usage limit reset')
    expect(formatChatHandoff({ status: 'refused', reason: 'source-busy', message: 'busy' })).toBe(
      'Not handed off: busy'
    )
  })
})

describe('orca chat history', () => {
  it('prints entries oldest first and how to read further back', () => {
    const text = formatChatHistory({
      sessionId: 'chat-claude-0001',
      agent: 'claude',
      name: 'Fix the login',
      entries: [
        { seq: 7, role: 'user', text: 'go' },
        { seq: 8, role: 'assistant', text: 'done', cut: true }
      ],
      nextBefore: 7
    })
    expect(text.split('\n')).toEqual([
      '[#7 user] go',
      '[#8 assistant] (cut) done',
      '',
      'Older entries: orca chat history chat-claude-0001 --before 7'
    ])
  })
})
