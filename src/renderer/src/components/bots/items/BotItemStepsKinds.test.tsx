// @vitest-environment happy-dom
// Fork BAD-762: a step is a command (typed into a terminal on request), text to copy and paste elsewhere,
// or a manual act. Text never offers Open in terminal, shows no host badge, and a manual step names none.

import { cleanup, render as renderBare, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { botItemStepsFromEvents } from '../../../../../shared/bots/bot-item-steps'
import { BotItemSteps } from './BotItemSteps'

afterEach(cleanup)

const view = botItemStepsFromEvents(
  {
    id: 1,
    data: {
      steps: [
        { title: 'Run it', command: 'pnpm check', host: 'laptop' },
        { title: 'Say this in Slack', text: 'whats the status', host: 'laptop' },
        { title: 'Click Approve', host: 'laptop' }
      ]
    }
  },
  [{ id: 2, data: { set: 'e1', index: 0, state: 'done' } }],
  'e1'
)!

function renderSteps(): void {
  renderBare(
    <BotItemSteps
      view={view}
      onMark={() => Promise.resolve(true)}
      terminalFor={() => ({ canOpen: true, open: vi.fn() })}
    />,
    { wrapper: TooltipProvider }
  )
}

it('shows text as a copy block with no terminal button, and the badge only on a command', () => {
  renderSteps()
  // Step 2 is the current one: its text shows.
  expect(document.querySelector('[data-bot-item-text]')?.textContent).toBe('whats the status')
  expect(screen.getByRole('button', { name: 'Copy text' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Open in terminal' })).toBeNull()
  // Only the command step carries "on laptop": text and a click are not run on a computer.
  expect(screen.queryAllByText('on laptop')).toHaveLength(1)
})

it('keeps the number beside its title so a long title wraps next to it', () => {
  renderSteps()
  const number = screen.getByText('2.')
  const button = number.closest('button')!
  expect(button.className).not.toContain('flex-wrap')
  expect(number.className).toContain('shrink-0')
  expect(number.nextElementSibling?.className).toContain('flex-1')
})

it('says do this yourself on a manual step', () => {
  renderSteps()
  expect(screen.getAllByText('do this yourself').length).toBeGreaterThan(0)
})
