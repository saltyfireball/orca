// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { structuredAgentSessionPaneKey } from '../../../../shared/agent-session/view/structured-agent-session-projection'
import { inboxItem, installFakeBridge, NOW } from './decision-inbox-test-kit'

type FakeState = {
  settings: Record<string, unknown>
  unifiedTabsByWorktree: Record<string, unknown[]>
  agentStatusByPaneKey: ReadonlyMap<string, { worktreeId: string }>
}

const state: { current: FakeState } = {
  current: { settings: {}, unifiedTabsByWorktree: {}, agentStatusByPaneKey: new Map() }
}
const activate = vi.fn()
const toast = { message: vi.fn(), success: vi.fn(), error: vi.fn() }

vi.mock('../../store/index', () => ({
  useAppStore: Object.assign(<T,>(select: (s: FakeState) => T): T => select(state.current), {
    getState: () => state.current
  })
}))
vi.mock('../../components/sidebar/workspace-card/activity/use-worktree-agent-activation', () => ({
  activateWorktreeAgentPane: activate
}))
vi.mock('sonner', () => ({ toast }))

const { TooltipProvider } = await import('../../components/ui/tooltip')
const { ForkDecisionInboxButton } = await import('./ForkDecisionInboxButton')
const { ForkDecisionInboxHost } = await import('./ForkDecisionInboxHost')
const { getForkDecisionInboxQuickActions } = await import('./fork-decision-inbox-quick-actions')
const { closeForkDecisionInbox, openForkDecisionInbox } = await import('./decision-inbox-store')

const CHAT_TAB = { id: 'tab-1', entityId: 'session-1', contentType: 'agent-session' }
const PANE_KEY = structuredAgentSessionPaneKey(CHAT_TAB.id, CHAT_TAB.entityId)
const MINUTE = 60_000

function App(): React.JSX.Element {
  return (
    <TooltipProvider>
      <ForkDecisionInboxButton />
      <ForkDecisionInboxHost />
    </TooltipProvider>
  )
}

function toolbarButton(): HTMLElement {
  return screen.getByRole('button', { name: /^Decision inbox/ })
}

async function openDialog(): Promise<HTMLElement> {
  render(<App />)
  fireEvent.click(toolbarButton())
  return screen.findByRole('dialog')
}

beforeEach(() => {
  state.current = {
    // The sidebar button folds into Needs you (BAD-759) while that is on; these test the button.
    settings: { forkIdleSweepMode: 'inbox', forkNeedsYou: false },
    unifiedTabsByWorktree: { wt1: [CHAT_TAB] },
    agentStatusByPaneKey: new Map()
  }
  vi.clearAllMocks()
})

afterEach(() => {
  act(() => closeForkDecisionInbox())
  cleanup()
})

describe('with the Needs you list on (BAD-759)', () => {
  it('folds the sidebar button away, so the status bar control holds the only count', () => {
    state.current.settings = { forkIdleSweepMode: 'inbox' }
    installFakeBridge([inboxItem({})])
    const view = render(<App />)
    expect(view.container.querySelector('[data-decision-inbox-count]')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Decision inbox/ })).toBeNull()
  })
})

describe('with idle recovery off', () => {
  it('shows no button and no dialog, and never touches the bridge', () => {
    state.current.settings = { forkNeedsYou: false }
    const bridge = installFakeBridge([inboxItem({})])
    const view = render(<App />)
    act(() => openForkDecisionInbox())
    expect(view.container.textContent).toBe('')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(bridge.inbox).not.toHaveBeenCalled()
    expect(bridge.listenerCount()).toBe(0)
  })

  it('offers no palette entry', () => {
    state.current.settings = { forkNeedsYou: false }
    installFakeBridge()
    const actions = getForkDecisionInboxQuickActions()
    // The third is the letters history (SLRM-2389): this fake window has no letters bridge.
    expect(actions.map((action) => action.isAvailable({} as never).available)).toEqual([
      false,
      false,
      false
    ])
  })
})

describe('ForkDecisionInboxButton', () => {
  it('counts chats waiting on the user, with stalled chats apart', async () => {
    installFakeBridge([
      inboxItem({ chatId: 'a' }),
      inboxItem({ chatId: 'b' }),
      inboxItem({ chatId: 'c', verdict: 'stalled' })
    ])
    const view = render(<App />)
    await waitFor(() =>
      expect(
        view.container.querySelector('[data-decision-inbox-count="waiting"]')?.textContent
      ).toBe('2')
    )
    expect(view.container.querySelector('[data-decision-inbox-count="stalled"]')?.textContent).toBe(
      '1'
    )
    expect(toolbarButton().getAttribute('aria-label')).toBe(
      'Decision inbox: 2 waiting on you, 1 stalled'
    )
  })

  it('shows no badge when nothing waits', async () => {
    const bridge = installFakeBridge()
    const view = render(<App />)
    await waitFor(() => expect(bridge.inbox).toHaveBeenCalledTimes(1))
    expect(view.container.querySelector('[data-decision-inbox-count]')).toBeNull()
  })

  it('reads again on the change event and at no other time', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'setTimeout'] })
    try {
      const bridge = installFakeBridge()
      const view = render(<App />)
      await vi.waitFor(() => expect(bridge.inbox).toHaveBeenCalledTimes(1))
      await act(() => vi.advanceTimersByTimeAsync(10 * MINUTE))
      expect(bridge.inbox).toHaveBeenCalledTimes(1)

      bridge.setItems([inboxItem({})])
      await act(async () => bridge.emitChanged())
      await vi.waitFor(() =>
        expect(
          view.container.querySelector('[data-decision-inbox-count="waiting"]')?.textContent
        ).toBe('1')
      )
      expect(bridge.inbox).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops listening when it unmounts', async () => {
    const bridge = installFakeBridge()
    const view = render(<App />)
    await waitFor(() => expect(bridge.listenerCount()).toBe(1))
    view.unmount()
    expect(bridge.listenerCount()).toBe(0)
  })
})

describe('the dialog', () => {
  it('lists each chat with its title, kind, age and question', async () => {
    installFakeBridge([
      inboxItem({}),
      inboxItem({
        chatId: 'tab-2:leaf',
        kind: 'terminal',
        title: 'Release notes',
        verdict: 'stalled',
        question: '',
        reason: 'Offered to run the tests and stopped.',
        since: NOW - 3 * 60 * MINUTE,
        wakes: 1
      })
    ])
    const dialog = await openDialog()
    await waitFor(() => expect(dialog.textContent).toContain('Fix the importer'))
    expect(dialog.textContent).toContain('Should I keep the old column?')
    expect(dialog.textContent).toContain('Chat - claude - importer')
    expect(dialog.textContent).toContain('Waiting on you (1)')
    expect(dialog.textContent).toContain('Stalled (1)')
    expect(dialog.textContent).toContain('Release notes')
    expect(dialog.textContent).toContain('Terminal - claude - importer - woken 1 times')
    expect(dialog.textContent).toContain('Offered to run the tests and stopped.')
    expect(dialog.textContent).toContain('3h')
    // A stalled chat takes an answer too: the user telling the agent how to go on.
    expect(screen.getAllByRole('textbox')).toHaveLength(2)
    expect(screen.getByLabelText('Answer to Release notes').getAttribute('placeholder')).toContain(
      'Tell the agent how to go on'
    )
  })

  it('sends an answer to a stalled chat', async () => {
    const bridge = installFakeBridge([
      inboxItem({
        chatId: 'tab-2:leaf',
        kind: 'terminal',
        title: 'Release notes',
        verdict: 'stalled'
      })
    ])
    await openDialog()
    const box = (await screen.findByLabelText('Answer to Release notes')) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'Run the tests' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(box.value).toBe(''))
    expect(bridge.answer).toHaveBeenCalledWith({ chatId: 'tab-2:leaf', text: 'Run the tests' })
  })

  it('lists paused chats apart, frozen, and counts none of them', async () => {
    installFakeBridge([
      inboxItem({ chatId: 'a', title: 'Live one' }),
      inboxItem({ chatId: 'b', title: 'Paused asker', paused: true }),
      inboxItem({
        chatId: 'c',
        title: 'Paused staller',
        verdict: 'stalled',
        paused: true,
        wakeAt: NOW + MINUTE
      })
    ])
    const dialog = await openDialog()
    await waitFor(() => expect(dialog.textContent).toContain('Paused (2)'))
    expect(dialog.textContent).toContain('Waiting on you (1)')
    expect(dialog.textContent).not.toContain('Stalled (')
    expect(dialog.textContent).toContain('paused while waiting on you')
    expect(dialog.textContent).toContain('paused while stalled')
    expect(dialog.textContent).not.toContain('next wake in')
    expect(document.querySelector('[data-decision-inbox-count="waiting"]')?.textContent).toBe('1')
    expect(document.querySelector('[data-decision-inbox-count="stalled"]')).toBeNull()
    expect(
      document
        .querySelector('[data-decision-inbox-count="waiting"]')
        ?.closest('button')
        ?.getAttribute('aria-label')
    ).toBe('Decision inbox: 1 waiting on you')
    expect(screen.getAllByRole('button', { name: 'Resume recovery' })).toHaveLength(2)
  })

  it('says so when nothing waits', async () => {
    installFakeBridge()
    const dialog = await openDialog()
    await waitFor(() => expect(dialog.textContent).toContain('Nothing is waiting on you.'))
  })

  it('updates live on the change event and keeps a draft being typed', async () => {
    const bridge = installFakeBridge([inboxItem({})])
    const dialog = await openDialog()
    const box = await screen.findByLabelText('Answer to Fix the importer')
    fireEvent.change(box, { target: { value: 'Keep it' } })

    bridge.setItems([inboxItem({}), inboxItem({ chatId: 'session-2', title: 'Second chat' })])
    await act(async () => bridge.emitChanged())
    await waitFor(() => expect(dialog.textContent).toContain('Second chat'))
    expect((screen.getByLabelText('Answer to Fix the importer') as HTMLTextAreaElement).value).toBe(
      'Keep it'
    )
  })

  it('sends an answer in place and clears the box', async () => {
    const bridge = installFakeBridge([inboxItem({})])
    await openDialog()
    const box = (await screen.findByLabelText('Answer to Fix the importer')) as HTMLTextAreaElement
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    fireEvent.change(box, { target: { value: '  Keep it  ' } })
    fireEvent.click(send)
    await waitFor(() => expect(box.value).toBe(''))
    expect(bridge.answer).toHaveBeenCalledWith({ chatId: 'session-1', text: 'Keep it' })
    expect(toast.success).toHaveBeenCalledWith('Answer sent to Fix the importer.')
  })

  it('sends on Enter, and keeps the text when the chat stopped waiting', async () => {
    const bridge = installFakeBridge([inboxItem({})])
    bridge.setAnswerOutcome('not-waiting')
    await openDialog()
    const box = (await screen.findByLabelText('Answer to Fix the importer')) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'Keep it' } })
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    expect(bridge.answer).not.toHaveBeenCalled()
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(toast.message).toHaveBeenCalled())
    expect(bridge.answer).toHaveBeenCalledTimes(1)
    expect(box.value).toBe('Keep it')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('pauses and resumes recovery for one chat', async () => {
    const bridge = installFakeBridge([inboxItem({})])
    await openDialog()
    fireEvent.click(await screen.findByRole('button', { name: 'Pause recovery' }))
    await waitFor(() =>
      expect(bridge.pause).toHaveBeenCalledWith({ chatId: 'session-1', paused: true })
    )

    bridge.setItems([inboxItem({ paused: true })])
    await act(async () => bridge.emitChanged())
    fireEvent.click(await screen.findByRole('button', { name: 'Resume recovery' }))
    await waitFor(() =>
      expect(bridge.pause).toHaveBeenLastCalledWith({ chatId: 'session-1', paused: false })
    )
  })

  it('jumps to the chat and closes', async () => {
    installFakeBridge([inboxItem({})])
    await openDialog()
    fireEvent.click(await screen.findByRole('button', { name: 'Go to chat' }))
    expect(activate).toHaveBeenCalledWith('wt1', 'tab-1', PANE_KEY)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('stays open and says so when the chat has no tab here', async () => {
    installFakeBridge([inboxItem({ chatId: 'gone', title: 'Gone chat' })])
    await openDialog()
    fireEvent.click(await screen.findByRole('button', { name: 'Go to chat' }))
    expect(activate).not.toHaveBeenCalled()
    expect(toast.message).toHaveBeenCalledWith('That chat has no open tab in this window.')
    expect(screen.queryByRole('dialog')).not.toBeNull()
  })
})

describe('the palette entries', () => {
  it('opens the dialog', async () => {
    installFakeBridge()
    render(<App />)
    const [open] = getForkDecisionInboxQuickActions()
    expect(open.isAvailable({} as never)).toEqual({ available: true })
    await act(async () => {
      await open.run({} as never)
    })
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('jumps to the chat that has waited longest', async () => {
    const terminalKey = 'tab-9:11111111-1111-4111-8111-111111111111'
    installFakeBridge([
      inboxItem({ chatId: 'stalled', verdict: 'stalled', since: NOW - 90 * MINUTE }),
      inboxItem({ since: NOW - 5 * MINUTE }),
      inboxItem({
        chatId: terminalKey,
        kind: 'terminal',
        worktreeId: 'wt2',
        since: NOW - 60 * MINUTE
      })
    ])
    const [, oldest] = getForkDecisionInboxQuickActions()
    expect(await oldest.run({} as never)).toEqual({ status: 'ok' })
    expect(activate).toHaveBeenCalledTimes(1)
    expect(activate.mock.calls[0]?.[0]).toBe('wt2')
    expect(activate.mock.calls[0]?.[2]).toBe(terminalKey)
  })

  it('says so when no chat waits', async () => {
    installFakeBridge([inboxItem({ verdict: 'stalled' })])
    const [, oldest] = getForkDecisionInboxQuickActions()
    await oldest.run({} as never)
    expect(activate).not.toHaveBeenCalled()
    expect(toast.message).toHaveBeenCalledWith('No chat is waiting on you.')
  })
})
