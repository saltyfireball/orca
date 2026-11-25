// @vitest-environment happy-dom
// The board (FORK.md "Letters and the board", SLRM-2389): the tray above a chat's message box and
// the asks in the Decision inbox, against a fake `window.api.forkLetters`.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ForkBoardView,
  ForkBoardViewAsk,
  ForkLettersApi
} from '../../../../shared/fork/letters-wire'

type FakeState = { settings: Record<string, unknown>; unifiedTabsByWorktree: object }
const state: { current: FakeState } = { current: { settings: {}, unifiedTabsByWorktree: {} } }
const toast = { message: vi.fn(), success: vi.fn(), error: vi.fn() }

vi.mock('../../store/index', () => ({
  useAppStore: Object.assign(<T,>(select: (s: FakeState) => T): T => select(state.current), {
    getState: () => state.current
  })
}))
vi.mock('sonner', () => ({ toast }))

const { TooltipProvider } = await import('../../components/ui/tooltip')
const { ForkBoardTray } = await import('./ForkBoardTray')
const { ForkDecisionInboxButton } = await import('../decision-inbox/ForkDecisionInboxButton')
const { ForkDecisionInboxHost } = await import('../decision-inbox/ForkDecisionInboxHost')
const { closeForkDecisionInbox, openForkDecisionInbox } =
  await import('../decision-inbox/decision-inbox-store')

const NOW = Date.parse('2026-11-18T12:00:00.000Z')

function ask(id: string, chatId: string, extra: Partial<ForkBoardViewAsk> = {}): ForkBoardViewAsk {
  return {
    id,
    type: 'REVIEW',
    title: `Ask ${id}`,
    body: `Body of ${id}`,
    from: {
      chatId,
      kind: 'chat',
      title: 'Builder',
      agent: 'claude',
      worktreeId: 'wt1',
      host: null
    },
    at: NOW - 5 * 60_000,
    state: 'open',
    closedAt: null,
    closedBy: null,
    note: null,
    source: null,
    ...extra
  }
}

function installBridge(asks: ForkBoardViewAsk[]) {
  let current = asks
  const bridge = {
    board: vi.fn(async (): Promise<ForkBoardView> => ({
      now: NOW,
      asks: current,
      unreachable: []
    })),
    closeAsk: vi.fn(async (request: Parameters<ForkLettersApi['closeAsk']>[0]) => {
      current = current.filter((a) => a.id !== request.id)
      return { ok: true as const }
    }),
    history: vi.fn(async () => ({ now: NOW, letters: [], unreachable: [] })),
    onChanged: vi.fn(() => () => {})
  }
  Object.assign(window, { api: { forkLetters: bridge } })
  return bridge
}

beforeEach(() => {
  // These tests are of the sidebar button; Needs you (BAD-759) folds it away while on. The bot
  // room hop limit (BAD-801) keeps the inbox on by itself, so it is off for the board alone.
  state.current = {
    settings: { forkNeedsYou: false, forkBotRoomHopLimit: 0 },
    unifiedTabsByWorktree: {}
  }
  vi.clearAllMocks()
})

afterEach(() => {
  act(() => closeForkDecisionInbox())
  cleanup()
})

describe('ForkBoardTray', () => {
  it("shows this chat's asks closed, opens to rows, and marks one done", async () => {
    const bridge = installBridge([
      ask('a1', 'session-1'),
      ask('a2', 'session-1', { type: 'DECIDE' }),
      ask('b1', 'other')
    ])
    render(<ForkBoardTray sessionId="session-1" />)
    const trigger = await screen.findByRole('button', { name: '2 asks for you from this chat' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Body of a1')).toBeNull()
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(screen.queryByText('Ask b1')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: 'Done' })[0])
    await waitFor(() =>
      expect(bridge.closeAsk).toHaveBeenCalledWith({
        id: 'a1',
        environmentId: null,
        action: 'done'
      })
    )
  })

  it('throws back only with a note', async () => {
    const bridge = installBridge([
      ask('a1', 'session-1', { source: { environmentId: 'env-1', name: 'gpu' } })
    ])
    render(<ForkBoardTray sessionId="session-1" />)
    fireEvent.click(await screen.findByRole('button', { name: /asks for you/ }))
    const back = screen.getByRole('button', { name: 'Throw back' })
    expect(back.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Split it.' } })
    fireEvent.click(back)
    await waitFor(() =>
      expect(bridge.closeAsk).toHaveBeenCalledWith({
        id: 'a1',
        environmentId: 'env-1',
        action: 'back',
        note: 'Split it.'
      })
    )
  })

  it('reads nothing while the board is off or the chat has no ask', async () => {
    state.current.settings = { forkBoard: false, forkNeedsYou: false }
    const bridge = installBridge([ask('a1', 'session-1')])
    const view = render(<ForkBoardTray sessionId="session-1" />)
    expect(view.container.textContent).toBe('')
    expect(bridge.board).not.toHaveBeenCalled()
    state.current.settings = { forkNeedsYou: false }
    cleanup()
    const empty = render(<ForkBoardTray sessionId="nobody" />)
    await waitFor(() => expect(bridge.board).toHaveBeenCalled())
    expect(empty.container.textContent).toBe('')
  })
})

describe('the Decision inbox with idle recovery off', () => {
  it('counts the open asks and lists them with Go to chat', async () => {
    installBridge([ask('a1', 'session-1'), ask('b1', 'other')])
    const view = render(
      <TooltipProvider>
        <ForkDecisionInboxButton />
        <ForkDecisionInboxHost />
      </TooltipProvider>
    )
    await waitFor(() =>
      expect(
        view.container.querySelector('[data-decision-inbox-count="waiting"]')?.textContent
      ).toBe('2')
    )
    act(() => openForkDecisionInbox())
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('Asks for you (2)')
    expect(dialog.textContent).toContain('Ask b1')
    expect(screen.getAllByRole('button', { name: 'Go to chat' })).toHaveLength(2)
  })
})
