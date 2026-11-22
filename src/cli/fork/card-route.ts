// Card routing (BAD-694, FORK.md): what `orca card route <KEY>` does, over calls the handler binds to
// the runtime, so the order of reads and writes is tested without one. A card goes to the bot its
// `bot:<name>` label or the owner's map names, in a chat titled "KEY: summary", and the card gets a
// comment naming the bot, its own chat and machine. When neither names one, the configured default bot (or
// the bot that ran the route, or the router) takes it (BAD-715); the owner gets a tap choice only when
// there is no such bot or forkCardAskOwner is on. A card someone already has is reported, not routed
// again, and one nothing names goes to the one bot whose repos it names (BAD-737).
import {
  cardChatSubject,
  cardStartComment,
  readForkCardAskOwner,
  readForkCardDefaultBot,
  readForkCardNoProjectBot,
  readForkCardRoutes,
  resolveCardRoute,
  type CardBotClaims,
  type CardFacts,
  type CardRoute
} from '../../shared/fork/card-routing'
import { cardClaimPaths, inferCardOwners } from '../../shared/fork/card-owner-inference'
import { readForkQuickTaskConfig } from '../../shared/fork/quick-task'
import type { BotRosterEntry, BotRosterServer } from '../../shared/bot-roster'
import type { BotItemStatus } from '../../shared/bots/bot-items'
import { untrustedContent } from '../../shared/quoted-text-fence'
import { priorCardOwner, type CardItemHit } from './card-route-prior-owner'

export type CardIssue = CardFacts & {
  url: string
  description: string | null
  /** The card's comment bodies, oldest first; an earlier hand-off's comment names its bot. */
  comments?: string[]
}

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
  /** Bot items, of any status, that link the card or name its key in their title. */
  items: (issue: CardIssue, roster: readonly BotRosterEntry[]) => Promise<CardItemHit[]>
  /** Each bot's claimed repos, from the hosts that run them; `paths` are the card's file paths. */
  claims: (paths: string[], roster: readonly BotRosterEntry[]) => Promise<CardBotClaims[]>
}

export type CardRouteRequest = {
  key: string
  handOff: boolean
  /** Only a `bot:` label may decide: for cards Orca hears about as they are created. */
  labelOnly: boolean
  /** The owner's choice, from an earlier tap choice. */
  bot?: string
}

type Via = 'label' | 'project' | 'team' | 'inferred' | 'no-project' | 'default' | 'chosen'

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
  | {
      kind: 'owned'
      key: string
      bot: string
      /** From an earlier hand-off's card comment. */
      chatId?: string | null
      machine?: string
      /** From the bot's item on the card. */
      item?: number
      status?: BotItemStatus
      next: string
    }
  /** An earlier "Which bot takes KEY?" still waits on the owner, in `bot`'s item. */
  | { kind: 'asked'; key: string; bot: string; item: number; next: string }

const DESCRIPTION_MAX = 3000
export const VIA_WORDS: Record<Via, string> = {
  label: 'its bot: label',
  project: "your owner's project map",
  team: "your owner's team map",
  inferred: 'the repo it names',
  'no-project': 'the bot for cards with no project',
  default: 'the default bot',
  chosen: "your owner's choice"
}

/** The first message of the bot's chat: the card, its text as data, and how work on it is kept. */
export function cardHandOffMessage(issue: CardIssue, via: Via, from?: string): string {
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
    `Finish this card end to end; nobody waits on your owner for it. Start any worker for it with \`worker-start ... --card ${key}\`, so its workspace lists under ${key}. Open the pull request and comment the link on the card (\`linear comment add ${key} --body "PR: <url>"\`). When its checks pass and nothing is unresolved, merge it yourself in a repository you own; then deploy or release as that repository's own process says, and move the card. A decision goes to ${from ? `${from}, who handed you this card (\`orchestration send --to bot:${botArgument(from)} --type question\`)` : 'the bot or coordinator that gave you this card'} first; take it to your owner only for a hard gate: sending to other people, secrets or sign-ins, deleting data, physical-security devices, force pushes, spending money, or a real security or data-loss risk. When it is done, report the result in one line to ${from ? from : 'the bot that handed it off, or its coordinator'} (\`orchestration send --to bot:<name> --type status\`) and in a card comment.`
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
  const self = roster.find((bot) => bot.self)
  // A failed lookup routes as before: a missed duplicate beats a card nobody can route.
  const prior = priorCardOwner(
    issue.comments ?? [],
    await calls.items(issue, roster).catch(() => []),
    roster.map((bot) => bot.name),
    router
  )
  const chosen = request.bot ?? (prior?.kind === 'answered' ? prior.bot : undefined)
  const sameBot = (name: string) => !request.bot || name.toLowerCase() === request.bot.toLowerCase()
  if ((prior?.kind === 'comment' || prior?.kind === 'item') && sameBot(prior.bot)) {
    return {
      kind: 'owned',
      key,
      bot: prior.bot,
      ...(prior.kind === 'comment'
        ? { chatId: prior.chatId, machine: prior.machine }
        : { item: prior.item, status: prior.status }),
      next: `orca card route ${key} --hand-off --bot <another bot>`
    }
  }
  if (prior?.kind === 'asked' && !request.bot) {
    return {
      kind: 'asked',
      key,
      bot: prior.bot,
      item: prior.item,
      next: `orca card route ${key} --hand-off --bot <their answer>`
    }
  }
  // The router only routes: it takes a card itself as the last resort, never because it ran the route.
  const fallbacks = readForkCardAskOwner(settings)
    ? []
    : [
        readForkCardDefaultBot(settings),
        self && self.name.toLowerCase() !== router.toLowerCase() ? self.name : null,
        router
      ].filter((name): name is string => Boolean(name))
  const routes = readForkCardRoutes(settings)
  let route = chosen
    ? chosenRoute(roster, chosen)
    : resolveCardRoute(issue, roster, routes, [router])
  if (!chosen && route.kind === 'choose' && !request.labelOnly) {
    const claims = await calls.claims(cardClaimPaths(issue), roster).catch(() => [])
    route = resolveCardRoute(issue, roster, routes, [router], fallbacks, {
      owners: inferCardOwners(issue, claims),
      noProjectBot: readForkCardNoProjectBot(settings)
    })
  }
  const via: Via | null = chosen ? 'chosen' : route.kind === 'bot' ? route.via : null
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
      next: `orca card route ${key} --hand-off${chosen ? ` --bot ${botArgument(route.bot.name)}` : ''}`
    }
  }
  const subject = cardChatSubject(issue)
  const started = await calls.start(route.bot.server, {
    bot: route.bot.name,
    subject,
    message: cardHandOffMessage(issue, via!, self?.name)
  })
  const machine = route.bot.server?.name ?? started.machine
  let commentError: string | undefined
  try {
    await calls.comment(key, cardStartComment(started.bot, started.chatId, machine, subject))
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
      context: `${issue.url}\nNo bot: label, no project map entry for ${issue.project ?? 'its project'}, no repo only one bot claims, and no default bot.`
    })
    return { kind: 'choose', key, choices: names, item, next }
  }
  // Outside a bot chat nothing can hold a tap choice, so the router posts it from its own chat.
  if (!router || router.paused) {
    return { kind: 'choose', key, choices: names, item: null, next }
  }
  const started = await calls.start(router.server, {
    bot: router.name,
    // Not the card's own title: the receiving bot's chat is the one titled "KEY: summary".
    subject: `Routing ${cardChatSubject(issue)}`.slice(0, 80),
    message: `Route Linear card ${key}: run \`orca card route ${key} --hand-off\` and do only what it prints.`
  })
  return { kind: 'choose', key, choices: names, item: null, router: started, next }
}
