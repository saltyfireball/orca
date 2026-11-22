// Card routing (BAD-737, FORK.md): the reads that tell `card route` who already has a card and which
// bots claim the repos it names. Items are read on this computer; claims from every host with a bot.
import type { RuntimeClient } from '../runtime/client'
import type { BotItem, BotItemEvent } from '../../shared/bots/bot-items'
import type { BotRosterEntry, BotRosterServer } from '../../shared/bot-roster'
import {
  FORK_CARD_ROUTE_CLAIMS_METHOD,
  type CardBotClaims,
  type ForkCardRouteClaimsResult
} from '../../shared/fork/card-routing'
import type { CardIssue } from './card-route'
import type { CardItemHit } from './card-route-prior-owner'

type Client = Pick<RuntimeClient, 'call'>

const PAGE = 100
const TIMEOUT_MS = 30_000

type ListResult = { items: BotItem[] }
type ShowResult = { item: BotItem; events: BotItemEvent[] }

function namesKey(title: string, key: string): boolean {
  const escaped = key.replace(/[-]/g, '\\-')
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![0-9])`, 'i').test(title)
}

/** An earlier `card route` choice: its done-means names the route, its question the key. */
function isRouteAsk(item: BotItem, key: string): boolean {
  const route = `card route ${key}`.toLowerCase()
  return (
    item.doneMeans?.toLowerCase().includes(route) === true ||
    item.question?.text.includes(`Which bot takes ${key}?`) === true
  )
}

async function ownerAnswer(client: Client, item: BotItem): Promise<string | null> {
  const { events } = (
    await client.call<ShowResult>('bots.items.show', { item: item.uid }, { timeoutMs: TIMEOUT_MS })
  ).result
  const answers = events.filter(
    (event) =>
      event.kind === 'commented' &&
      event.actor.kind === 'owner' &&
      typeof event.data.text === 'string'
  )
  const last = answers.at(-1)
  return last ? String(last.data.text) : null
}

/** Items of this computer's bots that link the card's URL or name its key, every status. */
export async function cardItemHits(
  client: Client,
  issue: CardIssue,
  roster: readonly BotRosterEntry[]
): Promise<CardItemHit[]> {
  const key = issue.key.toUpperCase()
  const local = roster.filter((bot) => !bot.server)
  const pages = await Promise.all(
    local.flatMap((bot) =>
      [{ link: issue.url }, {}].map(async (filter) => {
        const { items } = (
          await client.call<ListResult>(
            'bots.items.list',
            { botId: bot.id, all: true, limit: PAGE, ...filter },
            { timeoutMs: TIMEOUT_MS }
          )
        ).result
        return items.filter((item) => 'link' in filter || namesKey(item.title, key))
      })
    )
  )
  const seen = new Set<string>()
  const items = pages
    .flat()
    .filter((item) => (seen.has(item.uid) ? false : (seen.add(item.uid), true)))
  return Promise.all(
    items.map(async (item): Promise<CardItemHit> => {
      const bot =
        item.owner.name ?? local.find((entry) => entry.id === item.owner.botId)?.name ?? ''
      const hit = { bot, number: item.number, status: item.status }
      return isRouteAsk(item, key)
        ? { ...hit, ask: { answer: await ownerAnswer(client, item).catch(() => null) } }
        : hit
    })
  )
}

/** Every host's claims: this computer's, then each paired server's that runs a bot; one that can't
 *  answer (down, or older than BAD-737) claims nothing. */
export async function cardClaims(
  client: Client,
  serverClient: (server: BotRosterServer) => Client,
  paths: string[],
  roster: readonly BotRosterEntry[]
): Promise<CardBotClaims[]> {
  const servers = new Map<string, BotRosterServer>()
  for (const bot of roster) {
    if (bot.server) {
      servers.set(bot.server.on, bot.server)
    }
  }
  const read = (target: Client) =>
    target
      .call<ForkCardRouteClaimsResult>(
        FORK_CARD_ROUTE_CLAIMS_METHOD,
        { paths },
        { timeoutMs: TIMEOUT_MS }
      )
      .then((response) => response.result.bots)
      .catch((): CardBotClaims[] => [])
  const results = await Promise.all([
    read(client),
    ...[...servers.values()].map((server) => read(serverClient(server)))
  ])
  return results.flat()
}
