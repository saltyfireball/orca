// Card routing (BAD-694, FORK.md): what `orca card route` prints without --json.
import { VIA_WORDS, type CardRouteOutcome } from './card-route'

export function formatCardRouteOutcome(outcome: CardRouteOutcome): string {
  switch (outcome.kind) {
    case 'started':
      return [
        `${outcome.bot} took ${outcome.key} (by ${VIA_WORDS[outcome.via]}${outcome.source ? `: ${outcome.source}` : ''}).`,
        `${outcome.bot} chat id: ${outcome.chatId} (machine ${outcome.machine}, titled "${outcome.subject}").`,
        outcome.commented
          ? 'Commented on the card.'
          : `Could not comment on the card: ${outcome.commentError}`
      ].join('\n')
    case 'routed':
      return [
        `${outcome.key} goes to ${outcome.bot} (by ${VIA_WORDS[outcome.via]}${outcome.source ? `: ${outcome.source}` : ''}).`,
        `Hand it off: ${outcome.next}`
      ].join('\n')
    case 'choose':
      return [
        `No bot: label, project map entry, claimed repo or default bot names a bot for ${outcome.key}. Could be: ${outcome.choices.join(', ')}.`,
        outcome.item !== null
          ? `Posted the choice to your owner as item ${outcome.item}. When they answer, run: ${outcome.next}`
          : outcome.router
            ? `Router ${outcome.router.bot} posts the choice from its own routing chat ${outcome.router.chatId} on ${outcome.router.machine}; the card's chat starts once a bot is chosen.`
            : `--hand-off posts the choice to your owner; or pick one: ${outcome.next}`
      ].join('\n')
    case 'skipped':
      return `Nothing to do: ${outcome.why}`
    case 'owned':
      return [
        outcome.item !== undefined
          ? `${outcome.bot} already has ${outcome.key}: its item ${outcome.item} on the card. No new chat.`
          : `${outcome.bot} already has ${outcome.key}: chat ${outcome.chatId ?? 'not reported'} on ${outcome.machine}, from an earlier hand-off. No new chat.`,
        `Only to move it to another bot: ${outcome.next}`
      ].join('\n')
    case 'asked':
      return [
        `${outcome.bot} already asked your owner which bot takes ${outcome.key}, in item ${outcome.item}. No new question.`,
        `When they answer: ${outcome.next}`
      ].join('\n')
  }
}
