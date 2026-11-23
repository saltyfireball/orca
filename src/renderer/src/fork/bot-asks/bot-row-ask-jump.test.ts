// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Bot } from '../../../../shared/bot-types'
import { makeTestBotItem } from '../../../../shared/bots/bot-item.test-fixture'

type State = {
  settings: Record<string, unknown>
  rightSidebarOpen: boolean
  rightSidebarTab: string
  activeWorktreeId: string | null
}
const state: State = {
  settings: {},
  rightSidebarOpen: false,
  rightSidebarTab: 'files',
  activeWorktreeId: null
}
const NOW = 1_000_000_000
const counts = new Map<string, number | null>()
const callBotRpc = vi.fn()
const openBotItem = vi.fn()
const closeBotItem = vi.fn()
const forgetBotItemWalk = vi.fn()

vi.mock('@/store', () => ({ useAppStore: { getState: () => state } }))
vi.mock('@/lib/bot-hosts', () => ({
  botRefKey: (bot: { hostId: string; id: string }) => `${bot.hostId}:${bot.id}`,
  callBotRpc: (...args: unknown[]) => callBotRpc(...args)
}))
vi.mock('@/lib/bot-catalog', () => ({ readBots: () => [BOT] }))
vi.mock('@/lib/bot-catalog-snapshot', () => ({
  readBotItemsNeedingOwner: (bot: Bot) => counts.get(bot.id) ?? null
}))
vi.mock('@/components/bots/bot-workspace', () => ({
  findBotByWorkspace: (bots: Bot[], id: string | null) =>
    id === 'home-a' ? (bots.find((bot) => bot.id === 'a') ?? null) : null
}))
vi.mock('@/components/bots/items/bot-item-open', () => ({
  openBotItem: (...args: unknown[]) => openBotItem(...args),
  closeBotItem: (...args: unknown[]) => closeBotItem(...args)
}))
vi.mock('@/components/bots/items/use-bot-item-walk', () => ({
  forgetBotItemWalk: (...args: unknown[]) => forgetBotItemWalk(...args)
}))
vi.mock('./bot-asks-store', () => ({ readForkBotAsks: () => [] }))

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the module reads only id, name and hostId.
const BOT = { id: 'a', name: 'Bot a', hostId: 'local' } as Bot

const { forkOpenBotRow } = await import('./bot-row-ask-jump')

function waiting(...numbers: number[]): void {
  callBotRpc.mockResolvedValue({
    items: numbers.map((n) =>
      makeTestBotItem(n, { status: 'needs_you', lastActivityAt: NOW - 100 + n })
    )
  })
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Upstream's open: switches to the bot's home. */
function upstreamOpen(): boolean {
  state.activeWorktreeId = 'home-a'
  return true
}

/** What openBotItem does, plus the ask card the Home tab then draws. */
function showCard(): void {
  state.rightSidebarOpen = true
  state.rightSidebarTab = 'bot-activity'
  const card = document.createElement('div')
  card.setAttribute('data-bot-item-ask', 'open')
  document.body.appendChild(card)
}

beforeEach(() => {
  // Only the clock: the jump's reads still settle on real timers.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  state.settings = {}
  state.rightSidebarOpen = false
  state.rightSidebarTab = 'files'
  state.activeWorktreeId = null
  counts.clear()
  callBotRpc.mockReset()
  openBotItem.mockReset()
  closeBotItem.mockReset()
  forgetBotItemWalk.mockReset()
  openBotItem.mockImplementation(showCard)
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('forkOpenBotRow', () => {
  it('opens as upstream and reads nothing while the bot has nothing waiting', async () => {
    counts.set('a', 0)
    const open = vi.fn(upstreamOpen)
    expect(forkOpenBotRow(BOT, open)).toBe(true)
    await settle()
    expect(open).toHaveBeenCalledOnce()
    expect(callBotRpc).not.toHaveBeenCalled()
    expect(openBotItem).not.toHaveBeenCalled()
  })

  it('shows the Home list by default, leaving an open item, and reads nothing', async () => {
    counts.set('a', 2)
    expect(forkOpenBotRow(BOT, upstreamOpen)).toBe(true)
    await settle()
    expect(forgetBotItemWalk).toHaveBeenCalledWith('local:a')
    expect(closeBotItem).toHaveBeenCalledWith(BOT)
    expect(callBotRpc).not.toHaveBeenCalled()
    expect(openBotItem).not.toHaveBeenCalled()
  })

  it('leaves the list alone while the bot has nothing waiting or did not open', async () => {
    counts.set('a', 0)
    forkOpenBotRow(BOT, upstreamOpen)
    counts.set('a', 1)
    expect(forkOpenBotRow(BOT, () => false)).toBe(false)
    await settle()
    expect(closeBotItem).not.toHaveBeenCalled()
  })

  it.each([
    [true, 'item'],
    ['item', 'item'],
    [false, 'off'],
    ['off', 'off'],
    [undefined, 'list'],
    ['list', 'list']
  ])('a saved %s means %s', async (saved, meaning) => {
    counts.set('a', 1)
    waiting(1)
    state.settings = { forkBotRowAskJump: saved }
    forkOpenBotRow(BOT, upstreamOpen)
    await settle()
    expect(openBotItem).toHaveBeenCalledTimes(meaning === 'item' ? 1 : 0)
    expect(closeBotItem).toHaveBeenCalledTimes(meaning === 'list' ? 1 : 0)
  })

  it('opens the first waiting ask, then the next on a click while it shows', async () => {
    state.settings = { forkBotRowAskJump: 'item' }
    counts.set('a', 2)
    waiting(4, 5)
    forkOpenBotRow(BOT, upstreamOpen)
    await settle()
    expect(callBotRpc).toHaveBeenCalledWith(BOT, 'bots.items.owner.list', { botId: 'a' })
    expect(openBotItem).toHaveBeenLastCalledWith(BOT, 'uid-4')

    forkOpenBotRow(BOT, upstreamOpen)
    await settle()
    expect(openBotItem).toHaveBeenLastCalledWith(BOT, 'uid-5')

    // The panel moved off the Home tab: the next click starts at the first again.
    state.rightSidebarTab = 'files'
    forkOpenBotRow(BOT, upstreamOpen)
    await settle()
    expect(openBotItem).toHaveBeenLastCalledWith(BOT, 'uid-4')
  })

  it('keeps upstream alone with the setting off, or when the bot did not open', async () => {
    counts.set('a', 1)
    waiting(1)
    state.settings = { forkBotRowAskJump: 'off' }
    forkOpenBotRow(BOT, upstreamOpen)
    await settle()
    expect(callBotRpc).not.toHaveBeenCalled()

    state.settings = { forkBotRowAskJump: 'item' }
    expect(forkOpenBotRow(BOT, () => false)).toBe(false)
    await settle()
    expect(openBotItem).not.toHaveBeenCalled()
  })
})
