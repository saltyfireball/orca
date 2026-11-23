// @vitest-environment happy-dom
// Fork BAD-762: the open steps sit inside the Needs you card they were set with (the words, then the
// steps, then the question), never above the Activity where the pane's opening scroll leaves them off
// screen. With no open ask they stay above the Activity.

import { cleanup, render as renderBare, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Bot } from '../../../../../shared/bot-types'
import type { BotItemEvent } from '../../../../../shared/bots/bot-items'
import { botItemStepsFromEvents } from '../../../../../shared/bots/bot-item-steps'
import { makeTestBotItem } from '../../../../../shared/bots/bot-item.test-fixture'
import type { BotItemViewRead } from './use-bot-item-view'

const read = vi.hoisted((): { current: BotItemViewRead | null } => ({ current: null }))
vi.mock('./use-bot-item-view', () => ({ useBotItemView: () => read.current }))
vi.mock('./use-bot-items', () => ({
  commentOnBotItem: vi.fn(),
  setBotItemsStatus: vi.fn()
}))
vi.mock('../BotGroupTranscriptOwner', () => ({ useBotGroupFileContexts: () => new Map() }))
// The panel itself is tested with the checklist; here it is a marker of where the steps are drawn.
vi.mock('./BotItemStepsPanel', () => ({
  BotItemStepsPanel: () => <section data-bot-item-steps>Steps for you</section>
}))

import { BotItemView } from './BotItemView'
import { TooltipProvider } from '@/components/ui/tooltip'

const render = (ui: React.ReactElement) => renderBare(ui, { wrapper: TooltipProvider })

const BOT: Bot = {
  id: 'bot-a',
  name: 'Bot builder',
  hostId: 'local',
  folder: 'bot-builder',
  folderWorkspaceId: 'w1',
  agent: 'codex',
  avatar: null,
  paused: false,
  permissionMode: 'ask',
  notifications: { needsPermission: true, taskComplete: true, couldNotFinish: true },
  members: [],
  slack: null,
  chatSessionId: null,
  linear: null,
  github: null,
  createdAt: 1,
  updatedAt: 1
}
const ASKER = { kind: 'bot', botId: 'bot-a', chatId: 'chat-home' } as const

const steps = botItemStepsFromEvents(
  {
    id: 3,
    data: {
      steps: [
        { title: 'Run the check', command: 'pnpm check' },
        { title: 'Tell her', text: 'whats the status' },
        { title: 'Log in' }
      ]
    }
  },
  [],
  'e3'
)

const events: BotItemEvent[] = [
  {
    id: 'e2',
    kind: 'commented',
    actor: ASKER,
    data: {
      text: 'Do the steps in order.',
      ask: {
        context: 'Do the steps in order.',
        questions: [{ prompt: 'Did it stay on the page?', options: [{ label: 'Yes' }] }]
      }
    },
    at: 200
  },
  { id: 'e3', kind: 'steps', actor: ASKER, data: {}, at: 210 }
]

function show(question: boolean): void {
  read.current = {
    item: makeTestBotItem(6, {
      status: question ? 'needs_you' : 'working',
      question: question ? { eventId: 'e2', text: 'Did it stay on the page?' } : null,
      steps
    }),
    events,
    eventsRead: true,
    hasEarlier: false,
    failed: false,
    deleted: false,
    loadEarlier: vi.fn(),
    retry: vi.fn()
  }
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(cleanup)

it('draws the steps once, inside the ask card, after its words and before its question', () => {
  show(true)
  render(<BotItemView bot={BOT} uid="uid-6" />)

  expect(document.querySelectorAll('[data-bot-item-steps]')).toHaveLength(1)
  const card = screen.getByRole('article')
  const inCard = card.querySelector('[data-bot-item-steps]')
  expect(inCard).not.toBeNull()
  const order = (node: Node | null, other: Node | null): boolean =>
    !!node && !!other && !!(node.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING)
  expect(order(within(card).getByText('Do the steps in order.'), inCard)).toBe(true)
  expect(order(inCard, within(card).getByText('Did it stay on the page?'))).toBe(true)
  // The slim line points at it from the top of the item.
  expect(screen.getByRole('button', { name: 'Steps 1 of 3' })).toBeTruthy()
})

it('keeps the steps above the Activity when no ask holds them, with no slim line', () => {
  show(false)
  render(<BotItemView bot={BOT} uid="uid-6" />)

  const section = document.querySelector('[data-bot-item-steps]')!
  expect(section.closest('[role="article"]')).toBeNull()
  const activity = screen.getByRole('heading', { name: 'Activity' })
  expect(section.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.queryByRole('button', { name: /^Steps \d+ of \d+$/ })).toBeNull()
})
