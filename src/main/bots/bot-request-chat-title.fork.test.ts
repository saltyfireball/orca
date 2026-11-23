// Fork test (BAD-694): another bot's card handoff is titled with the card alone, so a search for the
// card key finds the chat. Kept apart from upstream's title tests.
import { expect, it } from 'vitest'
import { botRequestChatTitle } from './bot-request-view'

it("titles another bot's card handoff with the card alone", () => {
  expect(
    botRequestChatTitle(
      { fromBotId: 'ranger', fromBotName: 'Ranger' },
      'docs',
      'ABC-12: Fix the docs'
    )
  ).toBe('ABC-12: Fix the docs')
})
