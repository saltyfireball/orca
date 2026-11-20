// Bot asks in the Decision inbox (FORK.md "Idle recovery", SLRM-2453): the items a bot set to Needs
// you, on this host and its paired servers, listed with the inbox's other rows and told to its
// notify targets once each. Pure: the settings, the wire of the window's report to the main
// process, the key that dedupes a notice and the text the targets get.
import { z } from 'zod'

export type ForkInboxBotAsksSettings = {
  /** Fork (SLRM-2453): list the items bots set to Needs you in the Decision inbox, count them on its button and tell its notify targets of each new one; unset is on. */
  forkInboxBotAsks?: boolean
  /** Fork (SLRM-2453): also push a new bot ask to the phones paired with this desktop, under the app's notifications switch; unset is on. */
  forkInboxBotAsksPhone?: boolean
}

export type ForkInboxBotAsksConfig = { enabled: boolean; phone: boolean }

export type ForkInboxBotAsksSettingsSource =
  | Partial<Record<keyof ForkInboxBotAsksSettings, unknown>>
  | null
  | undefined

export function readForkInboxBotAsksSettings(
  source: ForkInboxBotAsksSettingsSource
): ForkInboxBotAsksConfig {
  return {
    enabled: source?.forkInboxBotAsks !== false,
    phone: source?.forkInboxBotAsksPhone !== false
  }
}

/** Most asks one report carries; past it the oldest are left to the next report. */
export const FORK_BOT_ASKS_MAX_REPORT = 200
const KEY_MAX = 1200
const TEXT_MAX = 500

/**
 * One ask's identity: the host, the bot, the item and the question event. A new question on the
 * same item is a new ask, and the same question read again is the same one.
 */
export function forkBotAskKey(
  hostId: string,
  botId: string,
  itemUid: string,
  questionEventId: string
): string {
  return [hostId, botId, itemUid, questionEventId].join('|')
}

export const ForkBotAskNotice = z.object({
  key: z.string().min(1).max(KEY_MAX),
  bot: z.string().max(TEXT_MAX),
  title: z.string().max(TEXT_MAX),
  question: z.string().max(TEXT_MAX),
  /** The window that reported it is focused and shows this ask (its bot's Home tab or the inbox). */
  onScreen: z.boolean().optional()
})

export const ForkBotAsksReportParams = z.object({
  asks: z.array(ForkBotAskNotice).max(FORK_BOT_ASKS_MAX_REPORT)
})

export type ForkBotAskNotice = z.infer<typeof ForkBotAskNotice>
export type ForkBotAsksReportRequest = z.infer<typeof ForkBotAsksReportParams>
export type ForkBotAsksReportResult = { notified: number }

function clip(value: string): string {
  return value.length > TEXT_MAX ? value.slice(0, TEXT_MAX) : value
}

/** A row title: the bot's name and the item's title. */
export function forkBotAskTitle(ask: Pick<ForkBotAskNotice, 'bot' | 'title'>): string {
  return clip(ask.bot ? `${ask.bot}: ${ask.title}` : ask.title)
}

/**
 * What the webhook gets as its body and the command on stdin: the shape idle recovery sends when
 * a chat starts waiting (`count`, `items` with `id`, `title`, `kind`, `question`), with kind
 * `bot-ask` and the ask's key as its id.
 */
export function forkBotAsksNotifyPayload(asks: readonly ForkBotAskNotice[]): string {
  return JSON.stringify({
    count: asks.length,
    items: asks.map((ask) => ({
      id: ask.key,
      title: forkBotAskTitle(ask),
      kind: 'bot-ask',
      question: clip(ask.question)
    }))
  })
}

const MAX_BODY_TITLES = 3

/** The desktop notification's words: one ask's question, or the names of several. */
export function forkBotAsksDesktopText(asks: readonly ForkBotAskNotice[]): {
  title: string
  body: string
} {
  if (asks.length === 1) {
    const ask = asks[0]!
    return {
      title: clip(ask.bot ? `${ask.bot} is waiting on you` : 'A bot is waiting on you'),
      body: clip(ask.question || ask.title)
    }
  }
  const names = asks.slice(0, MAX_BODY_TITLES).map((ask) => forkBotAskTitle(ask))
  const more = asks.length - names.length
  return {
    title: `${asks.length} bot asks are waiting on you`,
    body: clip(names.join(', ') + (more > 0 ? `, and ${more} more` : ''))
  }
}
