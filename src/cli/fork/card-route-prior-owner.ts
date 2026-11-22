// Card routing (BAD-737, FORK.md): who already has a card, so routing it again opens no second chat or
// question. In order: a card comment from an earlier hand-off, a bot item on the card, the owner's
// answer to an earlier "Which bot takes KEY?", and that question while it still waits.
import type { BotItemStatus } from '../../shared/bots/bot-items'

/** A bot item that links the card or names its key in the title. */
export type CardItemHit = {
  bot: string
  number: number
  status: BotItemStatus
  /** A "Which bot takes KEY?" item: the owner's answer, null while unanswered. */
  ask?: { answer: string | null }
}

export type PriorCardOwner =
  | { kind: 'comment'; bot: string; chatId: string | null; machine: string }
  | { kind: 'item'; bot: string; item: number; status: BotItemStatus }
  | { kind: 'answered'; bot: string; item: number }
  | { kind: 'asked'; bot: string; item: number }

const START_COMMENT = /^(.+?) bot on it, chat (not reported|\S+)(?: \(".*"\))?, machine (\S+)\s*$/su
const OPEN: readonly BotItemStatus[] = ['needs_you', 'working', 'planned']

/** The bot, chat and machine an earlier hand-off's card comment names (cardStartComment). */
export function parseCardStartComment(
  body: string
): { bot: string; chatId: string | null; machine: string } | null {
  const match = START_COMMENT.exec(body.trim())
  if (!match) {
    return null
  }
  const [, bot, chat, machine] = match as unknown as [string, string, string, string]
  return { bot, chatId: chat === 'not reported' ? null : chat, machine }
}

function namedBot(answer: string, bots: readonly string[]): string | null {
  const words = new Set(answer.toLowerCase().split(/[^\p{L}\p{N}_.-]+/u))
  const named = bots.filter((bot) => words.has(bot.toLowerCase()))
  return named.length === 1 ? named[0]! : null
}

/** Who has the card already; null when nobody does. `router` never owns one: it only routes. */
export function priorCardOwner(
  comments: readonly string[],
  hits: readonly CardItemHit[],
  bots: readonly string[],
  router: string
): PriorCardOwner | null {
  const known = new Set(bots.map((bot) => bot.toLowerCase()))
  for (const body of comments.toReversed()) {
    const started = parseCardStartComment(body)
    if (started && known.has(started.bot.toLowerCase())) {
      return { kind: 'comment', ...started }
    }
  }
  const work = hits
    .filter(
      (hit) =>
        !hit.ask && hit.status !== 'canceled' && hit.bot.toLowerCase() !== router.toLowerCase()
    )
    .sort((a, b) => Number(OPEN.includes(b.status)) - Number(OPEN.includes(a.status)))
  if (work[0]) {
    return { kind: 'item', bot: work[0].bot, item: work[0].number, status: work[0].status }
  }
  const asks = hits.filter((hit) => hit.ask)
  for (const hit of asks) {
    const bot = hit.ask?.answer ? namedBot(hit.ask.answer, bots) : null
    if (bot) {
      return { kind: 'answered', bot, item: hit.number }
    }
  }
  const waiting = asks.find((hit) => OPEN.includes(hit.status))
  return waiting ? { kind: 'asked', bot: waiting.bot, item: waiting.number } : null
}
