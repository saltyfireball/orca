import { describe, expect, it, vi } from 'vitest'
import {
  quickTaskService,
  type QuickTaskBot,
  type QuickTaskRouterInput,
  type QuickTaskServiceDeps
} from './quick-task-service'
import { quickTaskRouterBrief } from './quick-task-brief'

function fakeDeps(overrides: Partial<QuickTaskServiceDeps> = {}) {
  const bots: QuickTaskBot[] = []
  const created: QuickTaskRouterInput[] = []
  const chats: { bot: string; message: string }[] = []
  const deps: QuickTaskServiceDeps = {
    settings: () => ({}),
    botsEnabled: () => true,
    listBots: () => bots,
    createRouter: vi.fn(async (input: QuickTaskRouterInput) => {
      // As the controller does: the bot exists once create resolves.
      await Promise.resolve()
      created.push(input)
      const bot = { id: `bot-${bots.length + 1}`, name: input.name, paused: false }
      bots.push(bot)
      return bot
    }),
    startChat: vi.fn(async (bot: QuickTaskBot, message: string) => {
      chats.push({ bot: bot.name, message })
      return `chat-${chats.length}`
    }),
    cli: 'orca',
    ...overrides
  }
  return { deps, bots, created, chats }
}

describe('quickTaskService', () => {
  it('makes the router on first use and starts a new chat on it with the task', async () => {
    const { deps, created, chats } = fakeDeps()
    const result = await quickTaskService(deps).submit({
      text: ' add Cassie a voice ',
      source: 'desktop'
    })
    expect(created).toEqual([
      expect.objectContaining({
        name: 'Dispatcher',
        agent: 'claude',
        model: 'haiku',
        purpose: 'Routes quick tasks to the bot that owns them.'
      })
    ])
    expect(chats).toHaveLength(1)
    expect(chats[0].bot).toBe('Dispatcher')
    expect(chats[0].message).toContain('\nadd Cassie a voice\n')
    expect(result).toEqual({
      botName: 'Dispatcher',
      chatId: 'chat-1',
      note: 'Dispatcher is finding the bot that owns it and a machine to run it on.'
    })
  })

  it('says which machine runs the chat it opened (BAD-694)', async () => {
    const { deps } = fakeDeps({ machine: () => 'desk' })
    await expect(quickTaskService(deps).submit({ text: 'x', source: 'cli' })).resolves.toEqual(
      expect.objectContaining({ chatId: 'chat-1', machine: 'desk' })
    )
  })

  it('reuses a bot with the router name in any case', async () => {
    const { deps, bots, created } = fakeDeps()
    bots.push({ id: 'b1', name: 'dispatcher', paused: false })
    const result = await quickTaskService(deps).submit({ text: 'x', source: 'cli' })
    expect(created).toEqual([])
    expect(result.botName).toBe('dispatcher')
  })

  it('makes one router when two tasks arrive at once', async () => {
    const { deps, created, chats } = fakeDeps()
    const service = quickTaskService(deps)
    await Promise.all([
      service.submit({ text: 'one', source: 'desktop' }),
      service.submit({ text: 'two', source: 'mobile' })
    ])
    expect(created).toHaveLength(1)
    expect(chats.map((chat) => chat.bot)).toEqual(['Dispatcher', 'Dispatcher'])
  })

  it('keeps going after a failed task', async () => {
    const startChat = vi
      .fn<QuickTaskServiceDeps['startChat']>()
      .mockRejectedValueOnce(new Error('bot_session_refused'))
      .mockResolvedValue('chat-2')
    const { deps } = fakeDeps({ startChat })
    const service = quickTaskService(deps)
    await expect(service.submit({ text: 'one', source: 'cli' })).rejects.toThrow(
      'bot_session_refused'
    )
    await expect(service.submit({ text: 'two', source: 'cli' })).resolves.toMatchObject({
      chatId: 'chat-2'
    })
  })

  it('uses the router, agent and model from the settings', async () => {
    const { deps, created } = fakeDeps({
      settings: () => ({
        forkQuickTaskRouterBot: 'Router',
        forkQuickTaskRouterAgent: 'codex',
        forkQuickTaskPlacement: false
      })
    })
    const result = await quickTaskService(deps).submit({ text: 'x', source: 'cli' })
    expect(created[0]).toMatchObject({ name: 'Router', agent: 'codex', model: null })
    expect(result.note).toBe('Router is finding the bot that owns it.')
  })

  it('refuses when quick task or bots are off, and when the router is paused', async () => {
    const off = fakeDeps({ settings: () => ({ forkQuickTask: false }) })
    await expect(quickTaskService(off.deps).submit({ text: 'x', source: 'cli' })).rejects.toThrow(
      'Quick task is off'
    )
    const noBots = fakeDeps({ botsEnabled: () => false })
    await expect(
      quickTaskService(noBots.deps).submit({ text: 'x', source: 'cli' })
    ).rejects.toThrow('Bots are off')
    const paused = fakeDeps()
    paused.bots.push({ id: 'b1', name: 'Dispatcher', paused: true })
    await expect(
      quickTaskService(paused.deps).submit({ text: 'x', source: 'cli' })
    ).rejects.toThrow('Dispatcher is paused')
    expect(paused.chats).toEqual([])
  })

  it('refuses a request that is not a quick task before touching any bot', async () => {
    const { deps, created } = fakeDeps()
    const service = quickTaskService(deps)
    await expect(service.submit({ text: '   ', source: 'cli' })).rejects.toThrow('1 to 8000')
    await expect(service.submit({ text: 'x', source: 'email' })).rejects.toThrow('1 to 8000')
    await expect(service.submit(null)).rejects.toThrow('1 to 8000')
    expect(created).toEqual([])
  })
})

describe('quickTaskRouterBrief', () => {
  it('names bot list, the placement command with --repo, a new-chat handoff and the ask', () => {
    const brief = quickTaskRouterBrief({
      text: 'fix the login test',
      source: 'mobile',
      placementCommand: 'orca placement --json',
      cli: '"${ORCA_CLI_COMMAND:-orca}"'
    })
    expect(brief).toContain('from the quick task box on the phone')
    expect(brief).toContain('`"${ORCA_CLI_COMMAND:-orca}" bot list`')
    expect(brief).toContain(
      '`"${ORCA_CLI_COMMAND:-orca}" placement --json` (add `--repo <project>`'
    )
    expect(brief).toContain('--type handoff --chat new')
    expect(brief).toContain('[--on <server>]')
    expect(brief).toContain('bot create --offer')
    expect(brief).toContain('When the task itself is to set up bots, the cards are the whole job')
    expect(brief).toContain('ask your owner here which one')
  })

  it('runs a custom placement command as typed, and none when placement is off', () => {
    const custom = quickTaskRouterBrief({
      text: 'x',
      source: 'cli',
      placementCommand: 'server-pick --json',
      cli: 'orca'
    })
    expect(custom).toContain('run `server-pick --json` (when it takes a repo')
    expect(custom).toContain("add `--repo` with the project's path from `orca repo list`")
    expect(custom).not.toContain('--repo <project>`)')
    const none = quickTaskRouterBrief({
      text: 'x',
      source: 'cli',
      placementCommand: null,
      cli: 'orca'
    })
    expect(none).toContain('Do not suggest a machine')
    expect(none).not.toContain('Placement:')
  })
})
