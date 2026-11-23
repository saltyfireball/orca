import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCA_SCRUB_SAFE_PANE_ENV } from '../../../shared/agent-hook-listener/transport/agent-hook-scrub-safe-env'
import { ORCA_STRUCTURED_SESSION_ENV } from '../../../shared/agent-launch/environment/structured-session-marker'

import {
  BOT_TOOLS_TOKEN_ENV,
  ORCA_AGENT_SESSION_ID_ENV
} from '../../../shared/agent-session/lifecycle/launch/agent-session-caller-env'

import { ORCHESTRATION_PEER_MAIL_RUNTIME_CAPABILITY } from '../../../shared/orchestration/orchestration-runtime-capabilities'

const callMock = vi.hoisted(() => vi.fn())
const getTerminalHandleMock = vi.hoisted(() => vi.fn())

vi.mock('../../output/command-result-output', () => ({ printResult: vi.fn() }))
vi.mock('../agent-view', () => ({ printOrchestrationResult: vi.fn() }))
vi.mock('../../terminals/terminal-selector', () => ({ getTerminalHandle: getTerminalHandleMock }))

import { ORCHESTRATION_HANDLERS } from '../orchestration-handlers'

const IDENTITY_ENV = [
  'ORCA_TERMINAL_HANDLE',
  'ORCA_PANE_KEY',
  ORCA_SCRUB_SAFE_PANE_ENV,
  'CODEX_THREAD_ID',
  ORCA_STRUCTURED_SESSION_ENV,
  ORCA_AGENT_SESSION_ID_ENV,
  BOT_TOOLS_TOKEN_ENV
]
const saved = new Map(IDENTITY_ENV.map((name) => [name, process.env[name]]))

function send(extra: Record<string, string | boolean>) {
  const flags = new Map<string, string | boolean>(
    Object.entries({
      to: 'bot:Docs',
      chat: 'chat:abc',
      type: 'handoff',
      subject: 'From a service',
      body: 'use pnpm',
      ...extra
    })
  )
  return ORCHESTRATION_HANDLERS['orchestration send']!({
    flags,
    client: { call: callMock },
    cwd: '/tmp/repo',
    json: true
  } as never)
}

// BAD-742: a service with no terminal mails a bot chat without a sender handle.
describe('orchestration send --as-service', () => {
  beforeEach(() => {
    callMock.mockReset()
    callMock.mockImplementation(async (method: string) =>
      method === 'status.get'
        ? { result: { capabilities: [ORCHESTRATION_PEER_MAIL_RUNTIME_CAPABILITY] } }
        : { id: 'r', ok: true, result: { message: { id: 'msg_1' } } }
    )
    getTerminalHandleMock.mockReset()
    getTerminalHandleMock.mockRejectedValue(
      Object.assign(new Error('none'), { code: 'no_active_terminal' })
    )
    for (const name of IDENTITY_ENV) {
      delete process.env[name]
    }
  })
  afterEach(() => {
    for (const [name, value] of saved) {
      if (value === undefined) {
        delete process.env[name]
      } else {
        process.env[name] = value
      }
    }
  })

  it('sends to the bot chat with no sender and never looks for a terminal', async () => {
    await send({ 'as-service': true })
    expect(getTerminalHandleMock).not.toHaveBeenCalled()
    const [method, params] = callMock.mock.calls[0]!
    expect(method).toBe('orchestration.send')
    expect(params).toMatchObject({ to: 'bot:Docs', chat: 'chat:abc', from: undefined })
    expect(params.senderPaneKey).toBeUndefined()
  })

  it('still refuses without the flag when no terminal can be found', async () => {
    await expect(send({})).rejects.toMatchObject({ code: 'no_active_sender_terminal' })
    expect(callMock).not.toHaveBeenCalled()
  })

  it('keeps a terminal sending as that terminal', async () => {
    process.env.ORCA_TERMINAL_HANDLE = 'term_me'
    await send({})
    expect(callMock.mock.calls[0]![1]).toMatchObject({ from: 'term_me' })
  })

  it.each([
    ['a terminal handle', 'ORCA_TERMINAL_HANDLE'],
    ['a pane key', 'ORCA_PANE_KEY'],
    ['a scrub-safe pane key', ORCA_SCRUB_SAFE_PANE_ENV],
    ['a Codex thread', 'CODEX_THREAD_ID'],
    ['a chat session', ORCA_STRUCTURED_SESSION_ENV],
    ['an injected session id', ORCA_AGENT_SESSION_ID_ENV],
    ['a bot tools token', BOT_TOOLS_TOKEN_ENV]
  ])('is refused from inside an agent with %s', async (_label, name) => {
    process.env[name] = '1'
    await expect(send({ 'as-service': true })).rejects.toMatchObject({
      code: 'invalid_argument'
    })
    expect(callMock).not.toHaveBeenCalled()
  })

  it.each([
    ['a non-bot recipient', { to: 'term_x' }],
    ['--from', { from: 'term_x' }],
    ['--on', { on: 'alpha' }],
    ['a worker report', { type: 'worker_done' }]
  ])('refuses %s', async (_label, extra) => {
    await expect(send({ 'as-service': true, ...extra })).rejects.toBeInstanceOf(Error)
    expect(callMock).not.toHaveBeenCalledWith('orchestration.send', expect.anything(), undefined)
    expect(callMock.mock.calls.map(([method]) => method)).not.toContain('orchestration.send')
  })
})
