// Bot asks in the Decision inbox (FORK.md "Idle recovery", SLRM-2453): the pure rules. Which of a
// bot's items wait on the owner is upstream's own rule (`botItemGroupOf` is 'needs_you': Needs you,
// not stale, not snoozed), the same one behind the bot's "N needs you" and its Home tab's group.
import type { Bot } from '../../../../shared/bot-types'
import type { BotItem } from '../../../../shared/bots/bot-items'
import { botItemGroupOf, botItemStaleDays } from '../../../../shared/bots/bot-item-groups'
import { botItemQuestionLine } from '../../../../shared/bots/bot-item-ask'
import { forkBotAskKey, type ForkBotAskNotice } from '../../../../shared/fork/inbox-bot-asks'

export type ForkBotAsk = {
  /** `forkBotAskKey`: host, bot, item and question. */
  key: string
  bot: Bot
  item: BotItem
  /** Null when the item was set to Needs you with no question on it. */
  question: BotItem['question']
  /** Epoch ms of the item's last activity, as its row's age counts. */
  since: number
}

/** One bot's items as its host last listed them. */
export type ForkBotItemsRead = { bot: Bot; items: readonly BotItem[] }

/** Every item waiting on the owner across the reads, oldest first. */
export function forkBotAsksOf(reads: readonly ForkBotItemsRead[], now: number): ForkBotAsk[] {
  const asks: ForkBotAsk[] = []
  for (const { bot, items } of reads) {
    const staleDays = botItemStaleDays(bot.itemsStale)
    for (const item of items) {
      if (botItemGroupOf(item, staleDays, now) !== 'needs_you') {
        continue
      }
      asks.push({
        key: forkBotAskKey(
          bot.hostId,
          bot.id,
          item.uid,
          item.question?.eventId ?? item.lastEventId
        ),
        bot,
        item,
        question: item.question,
        since: item.lastActivityAt
      })
    }
  }
  return asks.sort((a, b) => a.since - b.since || a.key.localeCompare(b.key))
}

/** The question as one plain line, or the item's title when it has none. */
export function forkBotAskLine(ask: Pick<ForkBotAsk, 'question' | 'item'>): string {
  const line = ask.question ? botItemQuestionLine(ask.question.text) : ''
  if (line) {
    return line
  }
  const decision = ask.question?.decisions?.[0]?.question
  return decision ? botItemQuestionLine(decision) : ask.item.title
}

/** What the main process is told, for its notice. */
export function forkBotAskNotice(ask: ForkBotAsk, onScreen: boolean): ForkBotAskNotice {
  return {
    key: ask.key.slice(0, 1200),
    bot: (ask.item.owner.name ?? ask.bot.name).slice(0, 500),
    title: ask.item.title.slice(0, 500),
    question: forkBotAskLine(ask).slice(0, 500),
    ...(onScreen ? { onScreen: true } : {})
  }
}

/** Bots whose host counts Needs you items for them: only these are read. */
export function forkBotsWithAsks(
  bots: readonly Bot[],
  countOf: (bot: Bot) => number | null
): Bot[] {
  return bots.filter((bot) => (countOf(bot) ?? 0) > 0)
}

/**
 * Which of one bot's asks a click on its sidebar row shows (SLRM-2472): the first, or the one after
 * `shownUid` (wrapping) when the click lands while that ask is shown. Null with none waiting.
 */
export function forkBotRowAskPick(
  asks: readonly ForkBotAsk[],
  shownUid: string | null
): ForkBotAsk | null {
  if (asks.length === 0) {
    return null
  }
  const at = shownUid === null ? -1 : asks.findIndex((ask) => ask.item.uid === shownUid)
  return asks[(at + 1) % asks.length] ?? null
}
