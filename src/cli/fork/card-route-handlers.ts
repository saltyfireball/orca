// Card routing (BAD-694, FORK.md): `orca card route <KEY>`, bound to the runtime. The card is read and
// commented on through this Orca's Linear; a bot on a paired server is started on that server.
import type { CommandHandler, HandlerContext } from '../dispatch/dispatch'
import { getOptionalStringFlag, getRequiredStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { RuntimeClient } from '../runtime/client'
import { RuntimeClientError } from '../runtime/connection/types'
import { callerChat } from '../automations/automation-caller-chat'
import { buildIssueRequest, buildWriteTargetRequest } from '../linear/linear-request-builders'
import { botItemStatusFromCli } from '../bots/bot-item-cli-status'
import { botItemAskText } from '../../shared/bots/bot-item-ask'
import {
  FORK_CARD_ROUTE_START_METHOD,
  isCardKey,
  type ForkCardRouteStartResult
} from '../../shared/fork/card-routing'
import type { BotRosterEntry, BotRosterServer } from '../../shared/bot-roster'
import { cardClaims, cardItemHits } from './card-route-lookups'
import type { LinearIssueContextResult } from '../../shared/linear/agent-result-types'
import type { ForkSettingsGetResult } from '../../shared/fork/settings-wire'
import type { RuntimeRpcSuccess } from '../../shared/remote-runtime/rpc/runtime-rpc-envelope'
import { runCardRoute, type CardRouteCalls, type CardRouteOutcome } from './card-route'
import { formatCardRouteOutcome } from './card-route-format'

const CALL_TIMEOUT_MS = 75_000

function incompatible(error: unknown): never {
  if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
    throw new RuntimeClientError(
      'incompatible_runtime',
      'That Orca host cannot start a card chat. It needs a Blackfish build with BAD-694.'
    )
  }
  throw error
}

export function bindCardRouteCalls(ctx: HandlerContext): CardRouteCalls {
  const { client, cwd } = ctx
  const servers = new Map<string, RuntimeClient>()
  const serverClient = (server: BotRosterServer): RuntimeClient => {
    const target =
      servers.get(server.on) ??
      new RuntimeClient(client.userDataPath, CALL_TIMEOUT_MS, null, server.on)
    servers.set(server.on, target)
    return target
  }
  const inBotChat = Boolean(callerChat().callerSessionId)
  return {
    issue: async (key) => {
      const flags = new Map<string, string | boolean>([
        ['id', key],
        ['comments', true]
      ])
      const request = buildIssueRequest(flags, cwd, client.isRemote)
      const { issue, comments } = (
        await client.call<LinearIssueContextResult>('linear.issueContext', request, {
          timeoutMs: CALL_TIMEOUT_MS
        })
      ).result
      return {
        key: issue.identifier,
        title: issue.title,
        url: issue.url,
        description: issue.description ?? null,
        project: issue.project?.name ?? null,
        team: issue.team?.key ?? issue.team?.name ?? null,
        labels: issue.labels.flatMap((label) => (label.name ? [label.name] : [])),
        comments: (comments ?? []).map((comment) => comment.body)
      }
    },
    items: (issue, roster) => cardItemHits(client, issue, roster),
    claims: (paths, roster) => cardClaims(client, serverClient, paths, roster),
    roster: async () =>
      (
        await client.call<{ bots: BotRosterEntry[] }>('bots.roster', {
          ...callerChat(),
          allComputers: true
        })
      ).result.bots,
    settings: async () =>
      (await client.call<ForkSettingsGetResult>('fork.settings.get', {})).result.values,
    start: async (server, params) => {
      const target = server ? serverClient(server) : client
      return (
        await target
          .call<ForkCardRouteStartResult>(FORK_CARD_ROUTE_START_METHOD, params, {
            timeoutMs: CALL_TIMEOUT_MS
          })
          .catch(incompatible)
      ).result
    },
    comment: async (key, body) => {
      await client.call(
        'linear.issueAddComment',
        {
          ...buildWriteTargetRequest(new Map([['id', key]]), cwd, client.isRemote),
          body,
          ...(client.isRemote ? {} : callerChat())
        },
        { timeoutMs: CALL_TIMEOUT_MS }
      )
    },
    ask: inBotChat
      ? async (ask) => {
          const added = await client.call<{ item: { number: number } }>('bots.items.add', {
            ...callerChat(),
            title: ask.title,
            doneMeans: ask.doneMeans,
            links: [ask.link]
          })
          const decision = {
            context: ask.context,
            questions: [{ prompt: ask.question, options: ask.options, recommended: 0 }]
          }
          await client.call('bots.items.set', {
            ...callerChat(),
            item: String(added.result.item.number),
            status: botItemStatusFromCli('needs-you'),
            ask: decision,
            comment: botItemAskText(decision)
          })
          return added.result.item.number
        }
      : null
  }
}

export const FORK_CARD_ROUTE_HANDLERS: Record<string, CommandHandler> = {
  'card route': async (ctx) => {
    const key = getRequiredStringFlag(ctx.flags, 'key').trim()
    if (!isCardKey(key)) {
      throw new RuntimeClientError('invalid_argument', 'Name the card by its key, like BAD-12.')
    }
    let outcome: CardRouteOutcome
    try {
      outcome = await runCardRoute(bindCardRouteCalls(ctx), {
        key,
        handOff: ctx.flags.has('hand-off'),
        labelOnly: ctx.flags.has('label-only'),
        bot: getOptionalStringFlag(ctx.flags, 'bot')
      })
    } catch (error) {
      if (error instanceof RuntimeClientError) {
        throw error
      }
      throw new RuntimeClientError(
        'invalid_argument',
        error instanceof Error ? error.message : String(error)
      )
    }
    const response: RuntimeRpcSuccess<CardRouteOutcome> = {
      id: 'card-route',
      ok: true,
      result: outcome,
      _meta: { runtimeId: 'cli' }
    }
    printResult(response, ctx.json, formatCardRouteOutcome)
  }
}
