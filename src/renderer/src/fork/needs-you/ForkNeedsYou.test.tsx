// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = { settings: {} as Record<string, unknown>, statusBarVisible: true }
const jumpToNeedsYou = vi.fn()
const sendNeedsYouAnswer = vi.fn()
const openForkDecisionInbox = vi.fn()

vi.mock('@/store', () => ({
  useAppStore: Object.assign(<T,>(select: (s: typeof state) => T): T => select(state), {
    getState: () => state
  })
}))
vi.mock('@/components/bots/BotAvatar', () => ({ BotAvatar: () => <span data-avatar="bot" /> }))
vi.mock('@/components/agent/icons/AgentIcon', () => ({
  AgentIcon: () => <span data-avatar="agent" />
}))
vi.mock('@/lib/keyboard/useShortcutLabel', () => ({
  useShortcutLabel: () => 'Cmd+Shift+L',
  useOptionalShortcutLabel: () => 'Cmd+Shift+L'
}))
vi.mock('@/components/status-bar/composition/status-bar-context-menu-policy', () => ({
  STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS: {}
}))
vi.mock('../decision-inbox/decision-inbox-store', () => ({
  forkDecisionInboxAvailable: () => true,
  openForkDecisionInbox: () => openForkDecisionInbox()
}))
vi.mock('./needs-you-jump', () => ({
  jumpToNeedsYou: (...args: unknown[]) => jumpToNeedsYou(...args)
}))
vi.mock('./needs-you-answer', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendNeedsYouAnswer: (...args: unknown[]) => sendNeedsYouAnswer(...args)
}))
vi.mock('@/lib/bot-hosts', () => ({
  botRefKey: (b: { hostId: string; id: string }) => `${b.hostId}:${b.id}`,
  botTarget: (b: { hostId: string }) => ({ hostId: b.hostId })
}))
vi.mock('@/runtime/rpc/targets/runtime-client-target', () => ({
  runtimeTargetEnvironmentId: () => null
}))
vi.mock('@/runtime/rpc/compatibility/runtime-compatibility-cache', () => ({
  readCachedRuntimeEnvironmentCapability: () => true
}))
vi.mock('@/components/bots/items/use-bot-items', () => ({ commentOnBotItem: vi.fn() }))
vi.mock('@/components/bots/bot-presentation', () => ({ botErrorMessage: String }))
vi.mock('../bot-asks/bot-asks-store', () => ({ refreshForkBotAsks: vi.fn() }))
vi.mock('../decision-inbox/decision-inbox-actions', () => ({ answerDecisionInboxChat: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }))

const { TooltipProvider } = await import('@/components/ui/tooltip')
const store = await import('./needs-you-store')
const { ForkNeedsYouList } = await import('./ForkNeedsYouList')
const { ForkNeedsYouStatusSegment, ForkNeedsYouFloatingControl } =
  await import('./ForkNeedsYouControl')
const { needsYouEntries } = await import('./needs-you-view')
const { NOW, bot, botAsk, card, chat } = await import('./needs-you-test-kit')

const MINUTE = 60_000
const REPLIES = [
  { label: 'Render on kif', recommended: true },
  { label: 'Skip it', recommended: false }
]

function publish(parts: Partial<Parameters<typeof needsYouEntries>[0]>): void {
  act(() =>
    store.publishNeedsYouData({
      entries: needsYouEntries({
        botAsks: [],
        chats: [],
        chatClockOffset: Date.now() - NOW,
        board: [],
        boardClockOffset: 0,
        agents: [],
        ...parts
      }),
      inboxOnly: 2
    })
  )
}

function App(): React.JSX.Element {
  return (
    <TooltipProvider>
      <ForkNeedsYouStatusSegment />
      <ForkNeedsYouFloatingControl />
      <ForkNeedsYouList />
    </TooltipProvider>
  )
}

const ASK = botAsk(bot('a'), 10, Date.now() - 5 * MINUTE, {
  title: 'Office walkthrough',
  question: {
    eventId: 'e7',
    text: 'How should the review run now?',
    decisions: [{ question: 'How should the review run now?', replies: REPLIES }]
  }
})

beforeEach(() => {
  state.settings = {}
  state.statusBarVisible = true
  vi.clearAllMocks()
  jumpToNeedsYou.mockResolvedValue(true)
  sendNeedsYouAnswer.mockResolvedValue(true)
  act(() => {
    store.closeNeedsYou()
    store.publishNeedsYouData(store.NEEDS_YOU_NONE)
  })
})

afterEach(() => {
  act(() => store.closeNeedsYou())
  cleanup()
})

describe('the control', () => {
  it('is hidden at zero, shows the count otherwise, and opens the list', () => {
    render(<App />)
    expect(screen.queryByRole('button', { name: /Needs you/ })).toBeNull()
    publish({ botAsks: [ASK], chats: [chat('c', Date.now())] })
    const button = screen.getByRole('button', { name: 'Needs you 2' })
    fireEvent.click(button)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('floats at the corner only while the status bar is hidden', () => {
    publish({ botAsks: [ASK] })
    state.statusBarVisible = false
    const view = render(<App />)
    expect(view.container.querySelectorAll('[data-needs-you-control]').length).toBe(2)
    expect(view.container.querySelector('[data-needs-you-control="floating"]')).toBeTruthy()
  })

  it('is gone with the feature off', () => {
    state.settings = { forkNeedsYou: false }
    publish({ botAsks: [ASK] })
    const view = render(<App />)
    expect(view.container.textContent).toBe('')
    act(() => store.openNeedsYou())
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('the list', () => {
  it('opens with a clear empty state at zero', () => {
    render(<App />)
    act(() => store.openNeedsYou())
    expect(screen.getByText('Nothing is waiting on you.')).toBeTruthy()
  })

  it('shows the picture, name, item number, title, question, age and host of each row', () => {
    publish({
      botAsks: [ASK, botAsk(bot('p', 'ssh:paired-1'), 3, Date.now() - 2 * MINUTE)],
      hostLabelOf: (id) => (id === 'ssh:paired-1' ? 'Server one' : null)
    })
    render(<App />)
    act(() => store.openNeedsYou())
    const row = document.querySelector(`[data-needs-you-entry="bot:${ASK.key}"]`) as HTMLElement
    expect(within(row).getByText('#10')).toBeTruthy()
    expect(within(row).getByText('Office walkthrough')).toBeTruthy()
    expect(within(row).getByText('How should the review run now?')).toBeTruthy()
    expect(within(row).getByText('5m')).toBeTruthy()
    expect(row.querySelector('[data-avatar="bot"]')).toBeTruthy()
    expect(screen.getByText('Server one')).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Bot a \(1\)/ })).toBeTruthy()
  })

  it('filters, moves with the arrow keys and jumps with Enter', () => {
    publish({
      botAsks: [ASK, botAsk(bot('p'), 3, Date.now() - 2 * MINUTE, { title: 'Second thing' })]
    })
    render(<App />)
    act(() => store.openNeedsYou())
    const filter = screen.getByRole('textbox', { name: 'Filter' })
    // The most recent ask is first and selected.
    fireEvent.keyDown(filter, { key: 'Enter' })
    expect(jumpToNeedsYou).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Second thing' }),
      0
    )
    fireEvent.keyDown(filter, { key: 'ArrowDown' })
    fireEvent.keyDown(filter, { key: 'Enter' })
    expect(jumpToNeedsYou).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Office walkthrough' }),
      1
    )
    fireEvent.change(filter, { target: { value: 'walkthrough' } })
    expect(screen.queryByText('Second thing')).toBeNull()
    fireEvent.change(filter, { target: { value: 'nothing like it' } })
    expect(screen.getByText('Nothing matches that filter.')).toBeTruthy()
  })

  it('jumps on a click of a row', () => {
    publish({ botAsks: [ASK] })
    render(<App />)
    act(() => store.openNeedsYou())
    fireEvent.click(screen.getByText('Office walkthrough'))
    expect(jumpToNeedsYou).toHaveBeenCalledOnce()
  })

  it('links to the Decision inbox with the stalled count in its footer', () => {
    publish({ botAsks: [ASK] })
    render(<App />)
    act(() => store.openNeedsYou())
    fireEvent.click(screen.getByRole('button', { name: /Decision inbox \(2 stalled or paused\)/ }))
    expect(openForkDecisionInbox).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('quick answers', () => {
  it('show the options of the selected ask, and no key answers: only a press does', async () => {
    publish({ botAsks: [ASK] })
    render(<App />)
    act(() => store.openNeedsYou())
    const filter = screen.getByRole('textbox', { name: 'Filter' })
    // Letters, Enter, Space and digits in the filter answer nothing.
    for (const key of ['y', '1', ' ', 'Enter']) {
      fireEvent.keyDown(filter, { key })
    }
    const box = screen.getByRole('textbox', { name: 'Your answer' })
    fireEvent.change(box, { target: { value: 'Render on kif' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true })
    expect(sendNeedsYouAnswer).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Skip it' }))
    await waitFor(() => expect(sendNeedsYouAnswer).toHaveBeenCalledOnce())
    expect(sendNeedsYouAnswer.mock.calls[0]?.[2]).toBe('Skip it')
    // The answered ask leaves the list at once; Send was never needed for an option.
    await waitFor(() => expect(screen.queryByText('Office walkthrough')).toBeNull())
  })

  it('send the typed text only on Send', async () => {
    publish({ botAsks: [ASK] })
    render(<App />)
    act(() => store.openNeedsYou())
    const box = screen.getByRole('textbox', { name: 'Your answer' })
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    fireEvent.change(box, { target: { value: 'Render on kif, then mail me' } })
    fireEvent.click(send)
    await waitFor(() => expect(sendNeedsYouAnswer).toHaveBeenCalledOnce())
    expect(sendNeedsYouAnswer.mock.calls[0]?.[2]).toBe('Render on kif, then mail me')
  })

  it('keep a refused answer in the list', async () => {
    sendNeedsYouAnswer.mockResolvedValue(false)
    publish({ botAsks: [ASK] })
    render(<App />)
    act(() => store.openNeedsYou())
    fireEvent.click(screen.getByRole('button', { name: 'Skip it' }))
    await waitFor(() => expect(sendNeedsYouAnswer).toHaveBeenCalledOnce())
    expect(screen.getByText('Office walkthrough')).toBeTruthy()
  })

  it('offer no answer on an approval, which jumps to its own prompt', () => {
    publish({ agents: [card('p1', Date.now(), { conversationName: 'Deploy agent' })] })
    render(<App />)
    act(() => store.openNeedsYou())
    expect(screen.queryByRole('textbox', { name: 'Your answer' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
    expect(screen.getByText(/answered in the agent’s own prompt/)).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Filter' }), { key: 'Enter' })
    expect(jumpToNeedsYou).toHaveBeenCalledOnce()
  })

  it('open the item for an ask with several questions', () => {
    publish({
      botAsks: [
        botAsk(bot('a'), 4, Date.now(), {
          question: {
            eventId: 'e1',
            text: 'Two things',
            decisions: [
              { question: 'One?', replies: REPLIES },
              { question: 'Two?', replies: REPLIES }
            ]
          }
        })
      ]
    })
    render(<App />)
    act(() => store.openNeedsYou())
    expect(screen.queryByRole('button', { name: 'Skip it' })).toBeNull()
    expect(screen.getByText(/more than one question/)).toBeTruthy()
  })

  it('are off with the setting off', () => {
    state.settings = { forkNeedsYouQuickAnswers: false }
    publish({ botAsks: [ASK] })
    render(<App />)
    act(() => store.openNeedsYou())
    expect(screen.queryByRole('button', { name: 'Skip it' })).toBeNull()
  })
})
