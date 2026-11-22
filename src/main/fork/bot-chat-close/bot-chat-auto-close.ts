// Auto-close finished bot chats (FORK.md, BAD-734): one pass over a host's bots. It reads each bot's
// chats, gathers the facts the rule needs, closes (or, as a dry run, lists) every chat the rule
// closes, and leaves one compact row in the bot's Home Chat for each auto-started chat it closed.
import {
  forkBotChatCardKey,
  forkBotChatCloseVerdict,
  forkBotChatClosedNote,
  forkBotChatOutcome,
  forkBotChatAutoCloseGraceMs,
  forkBotChatAutoCloseIdleMs,
  type ForkBotChatCardState,
  type ForkBotChatCloseFacts,
  type ForkBotChatCloseReason,
  type ForkBotChatKeepReason
} from '../../../shared/fork/bot-chat-auto-close'
import type { BotChatTreeChat } from '../../../shared/bots/bot-chat-tree'

export type AutoCloseBot = { id: string; name: string; homeChatId: string | null }

/** What the host reads about a chat beyond its tree row. */
export type AutoCloseChatReads = Omit<
  ForkBotChatCloseFacts,
  'chat' | 'cardState' | 'autoStarted'
> & {
  autoStarted: boolean
  /** The chat's final reply, for the Home Chat row. */
  reply?: string
}

export type BotChatAutoCloseDeps = {
  now: () => number
  settings: unknown
  bots: () => readonly AutoCloseBot[]
  /** The bot's chats on this host, closed ones included. */
  readChats: (botId: string) => Promise<readonly BotChatTreeChat[] | null>
  readFacts: (bot: AutoCloseBot, chat: BotChatTreeChat) => Promise<AutoCloseChatReads>
  /** The card's state; `unknown` when Linear is not connected or the card is not found. */
  cardState: (key: string) => Promise<{ state: ForkBotChatCardState; url?: string }>
  close: (bot: AutoCloseBot, chat: BotChatTreeChat) => Promise<{ closed: boolean; detail?: string }>
  /** One status line in the bot's Home Chat: no turn, no wake. */
  noteInHome: (bot: AutoCloseBot, text: string) => void
}

export type BotChatAutoCloseRow = {
  botId: string
  botName: string
  chatId: string
  title: string
  outcome: 'closed' | 'would-close' | 'kept' | 'failed'
  reason?: ForkBotChatCloseReason
  keep?: ForkBotChatKeepReason
  cardKey?: string
  error?: string
  /** The server that answered, for a paired server's rows. */
  server?: string
}

export type BotChatAutoCloseResult = {
  dryRun: boolean
  enabled: boolean
  rows: BotChatAutoCloseRow[]
  servers: {
    name: string
    environmentId: string
    ok: boolean
    error?: string
    rows: BotChatAutoCloseRow[]
  }[]
}

export async function runBotChatAutoClosePass(
  deps: BotChatAutoCloseDeps,
  options: { bot?: string; dryRun: boolean; includeKept?: boolean }
): Promise<BotChatAutoCloseRow[]> {
  const now = deps.now()
  const times = {
    now,
    idleMs: forkBotChatAutoCloseIdleMs(deps.settings),
    graceMs: forkBotChatAutoCloseGraceMs(deps.settings)
  }
  const wanted = options.bot?.trim().toLowerCase()
  const bots = deps
    .bots()
    .filter(
      (bot) =>
        wanted === undefined || bot.id.toLowerCase() === wanted || bot.name.toLowerCase() === wanted
    )
  const cards = new Map<string, Promise<{ state: ForkBotChatCardState; url?: string }>>()
  const cardOf = (key: string) => {
    let known = cards.get(key)
    if (!known) {
      known = deps.cardState(key).catch(() => ({ state: 'unknown' as const }))
      cards.set(key, known)
    }
    return known
  }
  const rows: BotChatAutoCloseRow[] = []
  for (const bot of bots) {
    const chats = (await deps.readChats(bot.id).catch(() => null)) ?? []
    for (const chat of chats) {
      if (chat.origin === 'home' || chat.closed) {
        continue
      }
      const cardKey = forkBotChatCardKey(chat.title)
      const reads = await deps.readFacts(bot, chat)
      const card = cardKey ? await cardOf(cardKey) : { state: 'unknown' as const }
      const verdict = forkBotChatCloseVerdict(
        {
          chat,
          ...reads,
          autoStarted: reads.autoStarted || cardKey !== null,
          cardState: card.state
        },
        times
      )
      const base = {
        botId: bot.id,
        botName: bot.name,
        chatId: chat.chatId,
        title: chat.title,
        ...(cardKey ? { cardKey } : {})
      }
      if (!verdict.close) {
        if (options.includeKept) {
          rows.push({ ...base, outcome: 'kept', keep: verdict.keep })
        }
        continue
      }
      if (options.dryRun) {
        rows.push({ ...base, outcome: 'would-close', reason: verdict.reason })
        continue
      }
      const result = await deps.close(bot, chat).catch((error: unknown) => ({
        closed: false,
        detail: error instanceof Error ? error.message : String(error)
      }))
      if (!result.closed) {
        rows.push({
          ...base,
          outcome: 'failed',
          reason: verdict.reason,
          error: result.detail ?? 'not closed'
        })
        continue
      }
      rows.push({ ...base, outcome: 'closed', reason: verdict.reason })
      // Only a chat Orca started reports into Home; one the owner started closes quietly.
      if (reads.autoStarted || cardKey !== null) {
        deps.noteInHome(
          bot,
          forkBotChatClosedNote({
            title: chat.title,
            chatId: chat.chatId,
            cardKey,
            ...(card.url ? { cardUrl: card.url } : {}),
            outcome: forkBotChatOutcome(reads.reply ?? chat.preview),
            ...((reads.reply ?? chat.preview) ? { reply: reads.reply ?? chat.preview } : {})
          })
        )
      }
    }
  }
  return rows
}
