// Card routing (BAD-694, FORK.md): what `orca card route <KEY>` does, over calls the handler binds to
// the runtime, so the order of reads and writes is tested without one. A card goes to the bot its
// `bot:<name>` label or the owner's map names, in a chat titled "KEY: summary", and the card gets a
// comment naming the bot, chat and machine. When neither names one, the owner gets a tap choice.
import {
  cardChatSubject,
  cardStartComment,
  readForkCardRoutes,
  resolveCardRoute,
  type CardFacts,
  type CardRoute
} from '../../shared/fork/card-routing'
import { readForkQuickTaskConfig } from '../../shared/fork/quick-task'
import type { BotRosterEntry, BotRosterServer } from '../../shared/bot-roster'
import { untrustedContent } from '../../shared/quoted-text-fence'

export type CardIssue = CardFacts & { url: string; description: string | null }

export type CardChatStart = { bot: string; chatId: string; machine: string }

export type CardAsk = {
  title: string
  link: string
  doneMeans: string
  question: string
  options: { label: string; detail?: string }[]
  context: string
}

export type CardRouteCalls = {
  issue: (key: string) => Promise<CardIssue>
  roster: () => Promise<BotRosterEntry[]>
  settings: () => Promise<unknown>
  /** Starts a chat on a bot here, or on the paired server that runs it. */
  start: (
    server: BotRosterServer | undefined,
    params: { bot: string; subject: string; message: string }
  ) => Promise<CardChatStart>
  comment: (key: string, body: string) => Promise<void>
  /** Posts a Needs you item with the choice in the calling bot's chat; null outside a bot chat. */
  ask: ((ask: CardAsk) => Promise<number>) | null
}

export type CardRouteRequest = {
  key: string
  handOff: boolean
  /** Only a `bot:` label may decide: for cards Orca hears about as they are created. */
  labelOnly: boolean
  /** The owner's choice, from an earlier tap choice. */
  bot?: string
}

type Via = 'label' | 'project' | 'team' | 'chosen'

export type CardRouteOutcome =
  | {
      kind: 'started'
      key: string
      bot: string
      via: Via
      source: string | null
      chatId: string
      machine: string
      subject: string
      commented: boolean
      commentError?: string
    }
  | { kind: 'routed'; key: string; bot: string; via: Via; source: string | null; next: string }
  | {
      kind: 'choose'
      key: string
      choices: string[]
      item: number | null
      /** Outside a bot chat the choice goes to the router, which posts it from its own chat. */
      router?: CardChatStart
      next: string
    }
  | { kind: 'skipped'; key: string; why: string }

const DESCRIPTION_MAX = 3000
const VIA_WORDS: Record<Via, string> = {
  label: 'its bot: label',
  project: "your owner's project map",
  team: "your owner's team map",
  chosen: "your owner's choice"
}

/** The first message of the bot's chat: the card, its text as data, and how work on it is kept. */
export function cardHandOffMessage(issue: CardIssue, via: Via): string {
  const key = issue.key.toUpperCase()
  const description = issue.description?.trim()
  return [
    `Linear card ${key}: ${issue.title}`,
    issue.url,
    `${issue.project ? `Project ${issue.project}. ` : ''}It came to you by ${VIA_WORDS[via]}.`,
    ...(description
      ? ['', untrustedContent(`the card's description`, description.slice(0, DESCRIPTION_MAX))]
      : []),
    '',
    `Work this card through. Start any worker for it with \`worker-start ... --card ${key}\`, so its workspace lists under ${key}. When its pull request opens, comment the link on the card (\`linear comment add ${key} --body "PR: <url>"\`), and one line when it merges or closes.`
  ].join('\n')
}

function byName(roster: readonly BotRosterEntry[], name: string): BotRosterEntry | null {
  const key = name.toLowerCase()
  return roster.find((bot) => bot.name.toLowerCase() === key) ?? null
}

function botArgument(name: string): string {
  return /^[\w.@-]+$/u.test(name) ? name : `"${name.replace(/(["\\$`])/g, '\\$1')}"`
}

function chosenRoute(
  roster: readonly BotRosterEntry[],
  name: string
): CardRoute<BotRosterEntry> & { kind: 'bot' } {
  const bot = byName(roster, name)
  if (!bot) {
    throw new Error(`No bot named ${name}. \`orca bot list\` lists them.`)
  }
  if (bot.paused) {
    throw new Error(`${bot.name} is paused. Resume it in Bots, then route the card again.`)
  }
  return { kind: 'bot', bot, via: 'project', source: '' }
}

export async function runCardRoute(
  calls: CardRouteCalls,
  request: CardRouteRequest
): Promise<CardRouteOutcome> {
  const key = request.key.toUpperCase()
  const [issue, roster, settings] = await Promise.all([
    calls.issue(key),
    calls.roster(),
    calls.settings()
  ])
  const router = readForkQuickTaskConfig(settings).routerBot
  const route = request.bot
    ? chosenRoute(roster, request.bot)
    : resolveCardRoute(issue, roster, readForkCardRoutes(settings), [router])
  const via: Via | null = request.bot ? 'chosen' : route.kind === 'bot' ? route.via : null
  if (request.labelOnly && via !== 'label' && via !== 'chosen') {
    return { kind: 'skipped', key, why: `${key} has no bot: label naming a running bot.` }
  }
  if (route.kind === 'choose') {
    return request.handOff
      ? choose(calls, issue, route.choices, byName(roster, router))
      : {
          kind: 'choose',
          key,
          choices: route.choices.map((bot) => bot.name),
          item: null,
          next: `orca card route ${key} --hand-off --bot <choice>`
        }
  }
  const source = via === 'chosen' ? null : route.source
  if (!request.handOff) {
    return {
      kind: 'routed',
      key,
      bot: route.bot.name,
      via: via!,
      source,
      next: `orca card route ${key} --hand-off${request.bot ? ` --bot ${botArgument(route.bot.name)}` : ''}`
    }
  }
  const subject = cardChatSubject(issue)
  const started = await calls.start(route.bot.server, {
    bot: route.bot.name,
    subject,
    message: cardHandOffMessage(issue, via!)
  })
  const machine = route.bot.server?.name ?? started.machine
  let commentError: string | undefined
  try {
    await calls.comment(key, cardStartComment(started.bot, started.chatId, machine))
  } catch (error) {
    commentError = error instanceof Error ? error.message : String(error)
  }
  return {
    kind: 'started',
    key,
    bot: started.bot,
    via: via!,
    source,
    chatId: started.chatId,
    machine,
    subject,
    commented: commentError === undefined,
    ...(commentError ? { commentError } : {})
  }
}

async function choose(
  calls: CardRouteCalls,
  issue: CardIssue,
  choices: BotRosterEntry[],
  router: BotRosterEntry | null
): Promise<CardRouteOutcome> {
  const key = issue.key.toUpperCase()
  const names = choices.map((bot) => bot.name)
  if (names.length === 0) {
    return {
      kind: 'skipped',
      key,
      why: 'No running bot could take it. `orca bot list` lists them.'
    }
  }
  const next = `orca card route ${key} --hand-off --bot <choice>`
  if (calls.ask) {
    const item = await calls.ask({
      title: cardChatSubject(issue),
      link: issue.url,
      doneMeans: `Handed to the chosen bot with \`${next}\`.`,
      question: `Which bot takes ${key}?`,
      options: choices.map((bot) => ({
        label: bot.name,
        ...(bot.specialty || bot.server
          ? {
              detail: [bot.specialty, bot.server ? `on ${bot.server.name}` : null]
                .filter(Boolean)
                .join(' ')
            }
          : {})
      })),
      context: `${issue.url}\nNo bot: label, and no project map entry for ${issue.project ?? 'its project'}.`
    })
    return { kind: 'choose', key, choices: names, item, next }
  }
  // Outside a bot chat nothing can hold a tap choice, so the router posts it from its own chat.
  if (!router || router.paused) {
    return { kind: 'choose', key, choices: names, item: null, next }
  }
  const started = await calls.start(router.server, {
    bot: router.name,
    subject: cardChatSubject(issue),
    message: `Route Linear card ${key}: run \`orca card route ${key} --hand-off\` and do only what it prints.`
  })
  return { kind: 'choose', key, choices: names, item: null, router: started, next }
}

export function formatCardRouteOutcome(outcome: CardRouteOutcome): string {
  switch (outcome.kind) {
    case 'started':
      return [
        `${outcome.bot} took ${outcome.key} (by ${VIA_WORDS[outcome.via]}${outcome.source ? `: ${outcome.source}` : ''}).`,
        `Chat: ${outcome.chatId} on ${outcome.machine}, titled "${outcome.subject}".`,
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
        `Neither a bot: label nor the project map names a bot for ${outcome.key}. Could be: ${outcome.choices.join(', ')}.`,
        outcome.item !== null
          ? `Posted the choice to your owner as item ${outcome.item}. When they answer, run: ${outcome.next}`
          : outcome.router
            ? `${outcome.router.bot} posts the choice from chat ${outcome.router.chatId} on ${outcome.router.machine}.`
            : `--hand-off posts the choice to your owner; or pick one: ${outcome.next}`
      ].join('\n')
    case 'skipped':
      return `Nothing to do: ${outcome.why}`
  }
}
