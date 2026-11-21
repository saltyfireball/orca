// Card routing (BAD-694, FORK.md): which bot takes a Linear card. A `bot:<name>` label wins, then
// the owner's project (or team) to bot map, and only when neither answers are 2 or 3 bots offered
// as tap choices. Shared by `orca card route`, the quick task CLI and the bot request title.
import * as z from 'zod'
import { QUICK_TASK_TEXT_MAX } from './quick-task-contract'

/** A Linear card key, BAD-12; any case. */
export const FORK_CARD_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,15}-[0-9]{1,9}$/

/** Starts a card's chat on the bot that takes it, on the host that runs the bot. */
export const FORK_CARD_ROUTE_START_METHOD = 'fork.cardRoute.start'

export const ForkCardRouteStartParams = z.object({
  bot: z.string().trim().min(1).max(120),
  subject: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(QUICK_TASK_TEXT_MAX)
})

export type ForkCardRouteStartResult = { bot: string; chatId: string; machine: string }

export type ForkCardRoutingSettings = {
  /** Fork card routing (BAD-694): Linear project name or team key to the bot that takes its cards, e.g. {"Docs":"Writer"}; unset is no map. A card's `bot:<name>` label wins over it. */
  forkCardRoutes?: Record<string, string>
  /** Fork card routing (BAD-715): the bot that takes a card when no label or map entry names one; unset falls back to the bot that ran the route, then the quick task router. */
  forkCardDefaultBot?: string
  /** Fork card routing (BAD-715): when no label or map entry names a bot, post a choice to the owner instead of using the default bot; unset is false. */
  forkCardAskOwner?: boolean
}

/** What routing reads from a card. */
export type CardFacts = {
  key: string
  title: string
  project: string | null
  team: string | null
  labels: readonly string[]
}

/** A bot as the roster lists it; `server` is set for a bot on a paired server. */
export type CardRouteBot = {
  name: string
  paused?: boolean
  specialty?: string | null
  server?: { name: string; on: string }
}

export type CardRoute<B extends CardRouteBot> =
  | {
      kind: 'bot'
      bot: B
      via: 'label' | 'project' | 'team' | 'default'
      source: string
      note?: string
    }
  | { kind: 'choose'; choices: B[]; note?: string }

/** Fewest and most bots a choice offers. */
export const CARD_ROUTE_MIN_CHOICES = 2
export const CARD_ROUTE_MAX_CHOICES = 3
const MAX_ROUTES = 200
const MAX_NAME = 120
const SUBJECT_MAX = 80
const LABEL_BOT = /^bot\s*[:/]\s*(.+)$/i
const CARD_SUBJECT = /^[A-Za-z][A-Za-z0-9]{0,15}-[0-9]{1,9}: \S/

export function isCardKey(value: string): boolean {
  return FORK_CARD_KEY_PATTERN.test(value)
}

/** The owner's map, keys lowercased; anything that is not a short name to a short name is dropped. */
export function readForkCardRoutes(settings: unknown): Map<string, string> {
  const raw = ((settings ?? {}) as ForkCardRoutingSettings).forkCardRoutes
  const routes = new Map<string, string>()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return routes
  }
  for (const [key, value] of Object.entries(raw).slice(0, MAX_ROUTES)) {
    const from = key.trim().toLowerCase()
    const to = typeof value === 'string' ? value.trim() : ''
    if (from && to && from.length <= MAX_NAME && to.length <= MAX_NAME) {
      routes.set(from, to)
    }
  }
  return routes
}

/** The bot named as the default for cards nothing else routes; null when unset. */
export function readForkCardDefaultBot(settings: unknown): string | null {
  const raw = ((settings ?? {}) as ForkCardRoutingSettings).forkCardDefaultBot
  const name = typeof raw === 'string' ? raw.trim() : ''
  return name && name.length <= MAX_NAME ? name : null
}

/** True when the owner wants a choice posted, not a default bot, for a card nothing routes. */
export function readForkCardAskOwner(settings: unknown): boolean {
  return ((settings ?? {}) as ForkCardRoutingSettings).forkCardAskOwner === true
}

/** The bot names a card's `bot:<name>` (or `bot/<name>`) labels give, in label order. */
export function cardLabelBots(labels: readonly string[]): string[] {
  return labels.flatMap((label) => {
    const name = LABEL_BOT.exec(label.trim())?.[1]?.trim()
    return name ? [name] : []
  })
}

function byName<B extends CardRouteBot>(bots: readonly B[], name: string): B | null {
  const key = name.toLowerCase()
  return bots.find((bot) => bot.name.toLowerCase() === key) ?? null
}

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'that', 'this', 'bot'])

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 3 && !STOP_WORDS.has(word))
  )
}

/** The 2 or 3 bots most likely to own the card: most words shared with its title, project, team
 *  and labels; ties and the rest in roster order. */
export function cardRouteChoices<B extends CardRouteBot>(card: CardFacts, bots: readonly B[]): B[] {
  const cardWords = words([card.title, card.project, card.team, ...card.labels].join(' '))
  const scored = bots
    .map((bot, index) => {
      const botWords = words(`${bot.name} ${bot.specialty ?? ''}`)
      let score = 0
      for (const word of botWords) {
        score += cardWords.has(word) ? 1 : 0
      }
      return { bot, index, score }
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
  const matched = scored.filter((entry) => entry.score > 0).length
  const count = Math.min(
    scored.length,
    Math.max(CARD_ROUTE_MIN_CHOICES, Math.min(matched, CARD_ROUTE_MAX_CHOICES))
  )
  return scored.slice(0, count).map((entry) => entry.bot)
}

/** Which bot takes the card. `exclude` names bots that never take one (the router itself). */
export function resolveCardRoute<B extends CardRouteBot>(
  card: CardFacts,
  roster: readonly B[],
  routes: ReadonlyMap<string, string>,
  exclude: readonly string[] = [],
  /** Bot names to try, in order, when no label or map entry names one (BAD-715); they may include an excluded bot. */
  fallbacks: readonly string[] = []
): CardRoute<B> {
  const skip = new Set(exclude.map((name) => name.toLowerCase()))
  const bots = roster.filter((bot) => !bot.paused && !skip.has(bot.name.toLowerCase()))
  const missing: string[] = []
  for (const name of cardLabelBots(card.labels)) {
    const bot = byName(bots, name)
    if (bot) {
      return { kind: 'bot', bot, via: 'label', source: `bot:${name}` }
    }
    missing.push(name)
  }
  const note =
    missing.length > 0
      ? `No running bot is named ${missing.join(' or ')} (from the card's bot: label).`
      : undefined
  const mapped: ['project' | 'team', string | null][] = [
    ['project', card.project],
    ['team', card.team]
  ]
  for (const [via, value] of mapped) {
    const target = value ? routes.get(value.trim().toLowerCase()) : undefined
    const bot = target ? byName(bots, target) : null
    if (bot && value) {
      return { kind: 'bot', bot, via, source: value, ...(note ? { note } : {}) }
    }
  }
  const running = roster.filter((bot) => !bot.paused)
  for (const name of fallbacks) {
    const bot = byName(running, name)
    if (bot) {
      return { kind: 'bot', bot, via: 'default', source: bot.name, ...(note ? { note } : {}) }
    }
  }
  return { kind: 'choose', choices: cardRouteChoices(card, bots), ...(note ? { note } : {}) }
}

/** The subject, and so the chat title, a card's hand-off gets: "KEY: title". */
export function cardChatSubject(card: Pick<CardFacts, 'key' | 'title'>): string {
  const subject = `${card.key.toUpperCase()}: ${card.title.replace(/\s+/g, ' ').trim()}`
  return subject.length <= SUBJECT_MAX ? subject : `${subject.slice(0, SUBJECT_MAX - 1).trimEnd()}…`
}

/** A subject that starts with a card key ("BAD-12: ..."): its chat is titled with it alone. */
export function isCardChatSubject(subject: string): boolean {
  return CARD_SUBJECT.test(subject)
}

/** The bot preamble's line on cards, after its Linear line. */
export function forkCardToolLine(cli: string): string {
  return `- A Linear card to route (assigned to Orca, created with a \`bot:<name>\` label, or a task naming its key): \`${cli} card route <KEY> --hand-off\`, never a guess. It starts the bot the card's label, the project map or the configured default names, in a chat titled "KEY: summary", comments on the card with that chat's id and prints the chat id and machine. The receiving bot finishes the card end to end and reports back to the bot that handed it off. Only when no bot can be chosen at all does it post a choice for your owner: then run it again with \`--bot <their choice>\`. Work for a card: \`worker-start ... --card <KEY>\`, so its workspace lists under the card; when its PR opens, \`${cli} linear comment add <KEY> --body "PR: <url>"\`.`
}

/** The comment a card gets when a bot takes it: the receiving bot's own chat, by id and title. */
export function cardStartComment(
  bot: string,
  chatId: string | null,
  machine: string,
  subject?: string
): string {
  return `${bot} bot on it, chat ${chatId ?? 'not reported'}${subject ? ` ("${subject}")` : ''}, machine ${machine}`
}
