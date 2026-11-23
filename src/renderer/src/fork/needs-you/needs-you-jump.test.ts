import { beforeEach, describe, expect, it, vi } from 'vitest'

type State = Record<string, unknown>
const state: State = {}
const calls: string[] = []
const openBotHomeTab = vi.fn()
const openBotItem = vi.fn()
const activateAndRevealWorkspace = vi.fn()
const activateWorktreeAgentPane = vi.fn()
const jumpToDecisionInboxChat = vi.fn()
const jumpToForkBoardAsk = vi.fn()

vi.mock('@/store', () => ({ useAppStore: { getState: () => state } }))
vi.mock('@/lib/bot-hosts', () => ({
  botRefKey: (b: { hostId: string; id: string }) => `${b.hostId}:${b.id}`
}))
vi.mock('@/lib/bot-catalog', () => ({
  openBotHomeTab: (...args: unknown[]) => openBotHomeTab(...args)
}))
vi.mock('@/components/bots/items/bot-item-open', () => ({
  openBotItem: (...args: unknown[]) => openBotItem(...args)
}))
vi.mock('@/lib/workspace/activation/worktree-activation', () => ({
  activateAndRevealWorkspace: (...args: unknown[]) => activateAndRevealWorkspace(...args)
}))
vi.mock('@/components/sidebar/workspace-card/activity/use-worktree-agent-activation', () => ({
  activateWorktreeAgentPane: (...args: unknown[]) => activateWorktreeAgentPane(...args)
}))
vi.mock('../decision-inbox/decision-inbox-actions', () => ({
  jumpToDecisionInboxChat: (...args: unknown[]) => jumpToDecisionInboxChat(...args)
}))
vi.mock('../letters/board-actions', () => ({
  jumpToForkBoardAsk: (...args: unknown[]) => jumpToForkBoardAsk(...args)
}))
vi.mock('../bot-asks/bot-row-ask-jump', () => ({ revealAskCard: vi.fn() }))

const store = await import('./needs-you-store')
const { backFromNeedsYou, jumpToNeedsYou, jumpToNextNeedsYou } = await import('./needs-you-jump')
const { needsYouEntries } = await import('./needs-you-view')
const { NOW, boardAsk, bot, botAsk, card, chat } = await import('./needs-you-test-kit')

const entries = needsYouEntries({
  botAsks: [botAsk(bot('a'), 10, NOW - 50), botAsk(bot('b', 'ssh:paired-1'), 11, NOW - 40)],
  chats: [chat('c1', NOW - 10)],
  chatClockOffset: 0,
  board: [boardAsk('b1', NOW - 30)],
  boardClockOffset: 0,
  agents: [card('p1', NOW - 20, { executionHostId: 'ssh:paired-1' as never })]
})
const byKind = (kind: string) => entries.find((entry) => entry.target.kind === kind)!
const botAskOn = (hostId: string | null) =>
  entries.find((entry) => entry.target.kind === 'bot-ask' && entry.hostId === hostId)!

beforeEach(() => {
  for (const key of Object.keys(state)) {
    delete state[key]
  }
  Object.assign(state, {
    settings: {},
    activeView: 'terminal',
    activeWorktreeId: 'wt-here',
    activeWorkspaceExecutionHostId: 'local',
    activeTabId: 'tab-here',
    activeTabType: 'terminal',
    rightSidebarOpen: false,
    rightSidebarTab: 'explorer',
    setActiveTab: vi.fn(),
    setActiveTabType: vi.fn(),
    setRightSidebarTab: vi.fn(),
    setRightSidebarOpen: vi.fn(),
    setActiveView: vi.fn()
  })
  calls.length = 0
  for (const fn of [
    openBotHomeTab,
    openBotItem,
    activateAndRevealWorkspace,
    activateWorktreeAgentPane,
    jumpToDecisionInboxChat,
    jumpToForkBoardAsk
  ]) {
    fn.mockReset()
  }
  openBotHomeTab.mockResolvedValue(true)
  jumpToDecisionInboxChat.mockReturnValue(true)
  jumpToForkBoardAsk.mockReturnValue(true)
  store.endNeedsYouTrail()
  store.closeNeedsYou()
})

describe('jumpToNeedsYou', () => {
  it('opens a bot ask on its bot Home tab with the item open, from any view', async () => {
    state.activeView = 'settings'
    const entry = botAskOn(null)
    expect(await jumpToNeedsYou(entry, 0)).toBe(true)
    expect(openBotHomeTab).toHaveBeenCalledWith(entry.bot)
    expect(openBotItem).toHaveBeenCalledWith(
      entry.bot,
      entry.target.kind === 'bot-ask' ? entry.target.ask.item.uid : ''
    )
  })

  it("opens a paired server's bot ask the same way, through that bot", async () => {
    const entry = botAskOn('ssh:paired-1')
    expect(entry.hostId).toBe('ssh:paired-1')
    await jumpToNeedsYou(entry, 1)
    expect(openBotHomeTab).toHaveBeenCalledWith(expect.objectContaining({ hostId: 'ssh:paired-1' }))
    expect(openBotItem).toHaveBeenCalled()
  })

  it('opens a chat tab, a board ask by its chat, and an agent pane on its host', async () => {
    await jumpToNeedsYou(byKind('chat'), 0)
    expect(jumpToDecisionInboxChat).toHaveBeenCalledOnce()
    await jumpToNeedsYou(byKind('board'), 1)
    expect(jumpToForkBoardAsk).toHaveBeenCalledOnce()
    await jumpToNeedsYou(byKind('agent'), 2)
    expect(activateWorktreeAgentPane).toHaveBeenCalledWith('wt-p1', 'tab-p1', 'p1', 'ssh:paired-1')
  })

  it('closes the list and leaves no trail when the target cannot be shown', async () => {
    store.openNeedsYou()
    jumpToDecisionInboxChat.mockReturnValue(false)
    expect(await jumpToNeedsYou(byKind('chat'), 0)).toBe(false)
    expect(store.readNeedsYouTrail().ret).toBeNull()
  })

  it('survives a bot Home that cannot open', async () => {
    openBotHomeTab.mockResolvedValue(false)
    expect(await jumpToNeedsYou(botAskOn(null), 0)).toBe(false)
    expect(openBotItem).not.toHaveBeenCalled()
  })
})

describe('Next and Back', () => {
  it('goes to the following one without the list, and Back returns to the very first place', async () => {
    await jumpToNeedsYou(entries[0]!, 0)
    expect(store.readNeedsYouTrail().ret).toMatchObject({
      worktreeId: 'wt-here',
      tabId: 'tab-here'
    })
    // The owner moved on; the trail still remembers where it began.
    state.activeWorktreeId = 'wt-elsewhere'
    expect(await jumpToNextNeedsYou(entries)).toBe(true)
    expect(store.readNeedsYouTrail().last?.key).toBe(entries[1]!.key)
    expect(store.readNeedsYouTrail().ret).toMatchObject({ worktreeId: 'wt-here' })

    expect(backFromNeedsYou()).toBe(true)
    expect(activateAndRevealWorkspace).toHaveBeenCalledWith('wt-here', {
      executionHostId: 'local',
      revealInSidebar: false
    })
    expect(state.setActiveTab).toHaveBeenCalledWith('tab-here')
    expect(state.setRightSidebarOpen).toHaveBeenCalledWith(false)
    expect(state.setRightSidebarTab).toHaveBeenCalledWith('explorer')
    expect(store.readNeedsYouTrail().ret).toBeNull()
    expect(backFromNeedsYou()).toBe(false)
  })

  it('has no next with nothing waiting', async () => {
    expect(await jumpToNextNeedsYou([])).toBe(false)
  })
})
