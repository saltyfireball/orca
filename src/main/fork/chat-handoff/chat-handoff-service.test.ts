import { describe, expect, it, vi } from 'vitest'
import { readChatHandoffSettings } from '../../../shared/fork/chat-handoff'
import type { AgentJournalRenderItem } from '../../../shared/agent-session/journal/agent-session-journal-types'
import { readChatHandoffRows } from './chat-handoff-entries'
import { ChatHandoffLinks } from './chat-handoff-links'
import {
  ChatHandoffService,
  type ChatHandoffChat,
  type ChatHandoffContext,
  type ChatHandoffPorts
} from './chat-handoff-service'
import { fakeHistoryHost, said } from './chat-handoff-test-fixtures'
import { limitHandoffsDue } from './chat-handoff-on-limit'
import type { LimitResumeEntry } from '../../../shared/fork/limit-resume'

const CLAUDE = 'chat-claude-0001'
const CODEX = 'chat-codex-00001'

function chat(overrides: Partial<ChatHandoffChat> = {}): ChatHandoffChat {
  return {
    sessionId: CLAUDE,
    agent: 'claude',
    workspaceId: 'wt-1',
    name: 'Fix the login',
    inTurn: false,
    limitResumeScheduled: false,
    ...overrides
  }
}

function talk(from: number, count: number): AgentJournalRenderItem[] {
  return Array.from({ length: count }, (_, index) =>
    said(from + index, index % 2 === 0 ? 'user' : 'assistant', `line ${from + index}`)
  )
}

function rig(
  options: {
    chats?: ChatHandoffChat[]
    journals?: Record<string, AgentJournalRenderItem[]>
    context?: ChatHandoffContext
    settings?: Record<string, unknown>
    stopTurn?: boolean
  } = {}
) {
  const chats = new Map((options.chats ?? [chat()]).map((entry) => [entry.sessionId, entry]))
  const journals = options.journals ?? { [CLAUDE]: talk(1, 6) }
  const links = new ChatHandoffLinks(null)
  const ports: ChatHandoffPorts = {
    settings: () => readChatHandoffSettings(options.settings ?? null),
    chat: (id) => chats.get(id) ?? null,
    rows: (id, after) => readChatHandoffRows(fakeHistoryHost(journals[id] ?? []), id, { after }),
    context: async () =>
      options.context ?? { windowTokens: 200_000, usedTokens: 20_000, estimatedTokens: 0 },
    stopTurn: vi.fn(async () => options.stopTurn ?? true),
    create: vi.fn(async () => ({ ok: true as const, sessionId: CODEX })),
    send: vi.fn(async () => 'sent' as const),
    cancelLimitResume: vi.fn(async () => true),
    links,
    now: () => 1000
  }
  return { service: new ChatHandoffService(ports), ports, links }
}

describe('ChatHandoffService', () => {
  it('starts a new chat of the other agent in the same workspace with the history', async () => {
    const { service, ports, links } = rig()
    const result = await service.start({ sessionId: CLAUDE, to: 'codex', focus: true })
    expect(result).toMatchObject({
      status: 'started',
      mode: 'new',
      sessionId: CODEX,
      agent: 'codex',
      name: 'Fix the login (Codex)',
      entries: 6,
      omittedOlder: false
    })
    const created = vi.mocked(ports.create).mock.calls[0][0]
    expect(created).toMatchObject({ workspaceId: 'wt-1', agent: 'codex', focus: true })
    expect(created.text).toContain('[#1 user] line 1')
    expect(created.text).toContain(`Orca chat ${CLAUDE}`)
    expect(links.all()).toEqual([
      { from: CLAUDE, fromAgent: 'claude', to: CODEX, toAgent: 'codex', throughSeq: 6, at: 1000 }
    ])
  })

  it('refuses when off, unknown, the same agent, or another agent', async () => {
    expect(
      await rig({ settings: { forkChatHandoff: false } }).service.start({
        sessionId: CLAUDE,
        to: 'codex'
      })
    ).toMatchObject({ status: 'refused', reason: 'disabled' })
    const { service } = rig({ chats: [chat(), chat({ sessionId: 'chat-gemini-01', agent: 'x' })] })
    expect(await service.start({ sessionId: 'chat-nobody-001', to: 'codex' })).toMatchObject({
      reason: 'not-found'
    })
    expect(await service.start({ sessionId: CLAUDE, to: 'claude' })).toMatchObject({
      reason: 'same-agent'
    })
    expect(await service.start({ sessionId: 'chat-gemini-01', to: 'codex' })).toMatchObject({
      reason: 'unsupported-agent'
    })
  })

  it('refuses a busy chat unless asked to stop it, then stops it first', async () => {
    const busy = rig({ chats: [chat({ inTurn: true })] })
    expect(await busy.service.start({ sessionId: CLAUDE, to: 'codex' })).toMatchObject({
      reason: 'source-busy'
    })
    expect(busy.ports.create).not.toHaveBeenCalled()
    const stopped = await busy.service.start({ sessionId: CLAUDE, to: 'codex', stop: true })
    expect(stopped).toMatchObject({ status: 'started', stoppedSource: true })
    const stuck = rig({ chats: [chat({ inTurn: true })], stopTurn: false })
    expect(await stuck.service.start({ sessionId: CLAUDE, to: 'codex', stop: true })).toMatchObject(
      { reason: 'source-busy' }
    )
  })

  it('plans without starting anything on a dry run', async () => {
    const { service, ports, links } = rig()
    const result = await service.start({ sessionId: CLAUDE, to: 'codex', dryRun: true })
    expect(result).toMatchObject({ status: 'planned', mode: 'new', sessionId: null })
    expect(result.status === 'planned' && result.message).toContain('[#6 assistant] line 6')
    expect(ports.create).not.toHaveBeenCalled()
    expect(links.all()).toHaveLength(0)
  })

  it('refuses an empty chat with no request', async () => {
    const { service } = rig({ journals: { [CLAUDE]: [] } })
    expect(await service.start({ sessionId: CLAUDE, to: 'codex' })).toMatchObject({
      reason: 'empty'
    })
  })

  it('cancels the source resume at a usage limit reset', async () => {
    const { service, ports } = rig({ chats: [chat({ limitResumeScheduled: true })] })
    const result = await service.start({ sessionId: CLAUDE, to: 'codex' })
    expect(result).toMatchObject({ status: 'started', cancelledLimitResume: true })
    expect(ports.cancelLimitResume).toHaveBeenCalledWith(CLAUDE)
  })

  it('hands back into the earlier chat with only what is new while it has room', async () => {
    const codexChat = chat({ sessionId: CODEX, agent: 'codex', name: 'Fix the login (Codex)' })
    const journals = { [CLAUDE]: talk(1, 6), [CODEX]: talk(1, 10) }
    const { service, ports } = rig({ chats: [chat(), codexChat], journals })
    await service.start({ sessionId: CLAUDE, to: 'codex' })
    const back = await service.start({ sessionId: CODEX, to: 'claude' })
    expect(back).toMatchObject({ status: 'started', mode: 'continue', sessionId: CLAUDE })
    const [target, text] = vi.mocked(ports.send).mock.calls[0]
    expect(target).toBe(CLAUDE)
    expect(text).toContain('[#10 assistant] line 10')
    // Codex then works on; the next handoff to Claude carries only rows after the last one.
    journals[CODEX] = talk(1, 14)
    await service.start({ sessionId: CODEX, to: 'claude' })
    const second = vi.mocked(ports.send).mock.calls[1][1]
    expect(second).toContain('[#11 user] line 11')
    expect(second).not.toContain('[#10 assistant]')
  })

  it('starts fresh when the earlier chat has no room, or when asked', async () => {
    const codexChat = chat({ sessionId: CODEX, agent: 'codex' })
    const journals = { [CLAUDE]: talk(1, 6), [CODEX]: talk(1, 10) }
    const full = rig({
      chats: [chat(), codexChat],
      journals,
      context: { windowTokens: 200_000, usedTokens: 199_000, estimatedTokens: 0 }
    })
    await full.service.start({ sessionId: CLAUDE, to: 'codex' })
    vi.mocked(full.ports.create).mockResolvedValueOnce({ ok: true, sessionId: 'chat-claude-0002' })
    expect(await full.service.start({ sessionId: CODEX, to: 'claude' })).toMatchObject({
      mode: 'new',
      freshReason: 'context-full',
      sessionId: 'chat-claude-0002'
    })
    const asked = rig({ chats: [chat(), codexChat], journals })
    await asked.service.start({ sessionId: CLAUDE, to: 'codex' })
    expect(
      await asked.service.start({ sessionId: CODEX, to: 'claude', fresh: true })
    ).toMatchObject({ mode: 'new', freshReason: 'asked' })
    const off = rig({
      chats: [chat(), codexChat],
      journals,
      settings: { forkChatHandoffReuse: false }
    })
    await off.service.start({ sessionId: CLAUDE, to: 'codex' })
    expect(await off.service.start({ sessionId: CODEX, to: 'claude' })).toMatchObject({
      mode: 'new'
    })
  })

  it('reports a create the host refused', async () => {
    const { service, ports, links } = rig()
    vi.mocked(ports.create).mockResolvedValueOnce({ ok: false, message: 'memory is full' })
    expect(await service.start({ sessionId: CLAUDE, to: 'codex' })).toMatchObject({
      status: 'refused',
      reason: 'create-failed',
      message: 'memory is full'
    })
    expect(links.all()).toHaveLength(0)
  })
})

describe('limitHandoffsDue', () => {
  const entry: LimitResumeEntry = {
    id: `chat:${CLAUDE}`,
    kind: 'chat',
    paneKey: `chat:${CLAUDE}`,
    sessionId: CLAUDE,
    worktreeId: 'wt-1',
    agent: 'claude',
    title: 'Fix the login',
    resetsAt: 500,
    resumeAt: 560,
    tries: 0,
    maxTries: 5,
    state: 'parked',
    line: ''
  }

  it('hands off parked chats once, only when set to auto', () => {
    const auto = { enabled: true, onLimit: 'auto' as const }
    expect(limitHandoffsDue([entry], new Set(), auto)).toEqual([
      { sessionId: CLAUDE, to: 'codex', key: `${CLAUDE}:500` }
    ])
    expect(limitHandoffsDue([entry], new Set([`${CLAUDE}:500`]), auto)).toEqual([])
    expect(limitHandoffsDue([entry], new Set(), { enabled: true, onLimit: 'offer' })).toEqual([])
    expect(limitHandoffsDue([entry], new Set(), { enabled: false, onLimit: 'auto' })).toEqual([])
  })
})
