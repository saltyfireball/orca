// Needs you (FORK.md "Needs you list", BAD-759): the list with several bots, its empty state, and
// the status bar control beside a collapsed sidebar. Data is fixed; nothing here reads a host.
import { defineFixture } from '../../component-fixtures/component-fixture'
import { fixtureCos } from '../../component-fixtures/fixture-bot-panel'
import type { Bot } from '../../../../shared/bot-types'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ForkNeedsYouStatusSegment } from './ForkNeedsYouControl'
import { ForkNeedsYouList } from './ForkNeedsYouList'
import { NEEDS_YOU_NONE, openNeedsYou, publishNeedsYouData } from './needs-you-store'
import { needsYouEntries } from './needs-you-view'
import { boardAsk, botAsk, card, chat } from './needs-you-test-kit'

const MINUTE = 60_000
const bots: Bot[] = [
  { ...fixtureCos, id: 'bot-a', name: 'Planner' },
  { ...fixtureCos, id: 'bot-b', name: 'Reviewer', hostId: 'ssh:server-1' as never },
  { ...fixtureCos, id: 'bot-c', name: 'Builder' }
]

function seed(): void {
  const now = Date.now()
  const decisions = [
    {
      question: 'When should the check run?',
      replies: [
        { label: 'Run it tonight', recommended: true },
        { label: 'Run it now', recommended: false }
      ]
    }
  ]
  publishNeedsYouData({
    entries: needsYouEntries({
      botAsks: [
        botAsk(bots[0]!, 100, now - 2 * MINUTE, {
          title: 'Launch checklist',
          question: { eventId: 'e1', text: 'When should the check run?', decisions }
        }),
        botAsk(bots[0]!, 103, now - 40 * MINUTE, { title: 'Rotate the staging keys' }),
        botAsk(bots[1]!, 12, now - 9 * MINUTE, { title: 'Changelog wording' }),
        botAsk(bots[2]!, 7, now - 3 * 60 * MINUTE, { title: 'Pick the logo colour' })
      ],
      chats: [chat('c1', now - 5 * MINUTE, { title: 'Fix the importer', agent: 'claude' })],
      chatClockOffset: 0,
      board: [boardAsk('b1', now - 20 * MINUTE)],
      boardClockOffset: 0,
      agents: [card('p1', now - 60_000, { conversationName: 'Deploy agent', agentType: 'codex' })],
      hostLabelOf: (hostId) => (hostId === 'ssh:server-1' ? 'Studio server' : null)
    }),
    inboxOnly: 2
  })
}

export const several = defineFixture({
  width: 720,
  setup: seed,
  render: () => (
    <TooltipProvider>
      <div className="h-[640px]" />
      <ForkNeedsYouList />
    </TooltipProvider>
  ),
  interact: () => openNeedsYou()
})

export const empty = defineFixture({
  width: 720,
  setup: () => publishNeedsYouData(NEEDS_YOU_NONE),
  render: () => (
    <TooltipProvider>
      <div className="h-[420px]" />
      <ForkNeedsYouList />
    </TooltipProvider>
  ),
  interact: () => openNeedsYou()
})

/** The left sidebar folded away: the status bar still carries the control. */
export const collapsedSidebar = defineFixture({
  width: 900,
  setup: seed,
  render: () => (
    <TooltipProvider>
      <div className="flex h-72 flex-col border border-border bg-background text-xs">
        <div className="flex min-h-0 flex-1">
          <div className="w-9 border-r border-border bg-sidebar" />
          <div className="flex-1 p-4 text-muted-foreground">Terminal</div>
        </div>
        <div className="flex h-6 items-center gap-4 border-t border-border bg-card px-3">
          <ForkNeedsYouStatusSegment />
          <span className="text-muted-foreground">Used 18% 4d 9h</span>
        </div>
      </div>
    </TooltipProvider>
  )
})

/** The selected ask with options: its buttons and the text answer show. */
export const answering = defineFixture({
  width: 720,
  setup: seed,
  render: () => (
    <TooltipProvider>
      <div className="h-[640px]" />
      <ForkNeedsYouList />
    </TooltipProvider>
  ),
  interact: async () => {
    openNeedsYou()
    await new Promise((resolve) => setTimeout(resolve, 100))
    const filter = document.querySelector('input[aria-label="Filter"]')
    // Deploy agent is first; the next row is the Planner's newest ask.
    filter?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  }
})
