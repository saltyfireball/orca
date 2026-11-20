// BAD-640 (FORK.md "Bot connect from the CLI"): `orca bot connect` links the Linear workspaces and
// GitHub account the owner already connected on this host to bots that lack them, through the calls
// the Connectors setup makes: bots.linear.state and bots.github.state read the host's links, and
// bots.update saves the bot's own (linearWorkspaces, github: {}), as its Turn on does. It never starts
// a sign-in (bots.connect.*): a connector not connected yet is connected once in Orca.
import {
  BOT_MAX_CONNECTOR_WORKSPACES,
  botLinearWorkspaces,
  type Bot,
  type BotLinear
} from '../../shared/bot-types'
import { botOfAddress } from '../../shared/bot-roster'
import type {
  ConnectorLinearState,
  ConnectorLinearWorkspace
} from '../../shared/connector-bot-linear-contract'
import type { ConnectorGitHubState } from '../../shared/connector-bot-github-contract'
import type { BotSlackResult } from '../../shared/connector-bot-slack-contract'
import type { BotUpdateParams } from '../../shared/rpc-contract/bots-params'
import type { CommandHandler } from '../dispatch/dispatch'
import { getOptionalStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import type { BotsListResult } from '../bots/bot'

/** A host read: its answer, or why it could not be read. */
export type HostRead<T> = { ok: true; state: T } | { ok: false; message: string }

export type BotConnectWants = { linear: boolean; github: boolean }

export type BotConnectPlan = {
  bot: Bot
  updates: Pick<BotUpdateParams['updates'], 'linearWorkspaces' | 'github'>
  linked: string[]
  notes: string[]
}

export type BotConnectRow = {
  id: string
  name: string
  linked: string[]
  notes: string[]
}
export type BotConnectResult = { bots: BotConnectRow[] }

function invalid(message: string): RuntimeClientError {
  return new RuntimeClientError('invalid_argument', message)
}

/** --linear and --github; neither means both. */
export function readBotConnectWants(flags: Map<string, string | boolean>): BotConnectWants {
  const linear = flags.has('linear')
  const github = flags.has('github')
  return linear || github ? { linear, github } : { linear: true, github: true }
}

/** The bot --bot names, or every bot of the host for --all. */
export function selectBotsToConnect(
  bots: readonly Bot[],
  selection: { bot?: string; all: boolean }
): Bot[] {
  if (Boolean(selection.bot) === selection.all) {
    throw invalid('Name one bot with --bot <name>, or every bot on this computer with --all.')
  }
  if (selection.bot) {
    const bot = botOfAddress(bots, selection.bot)
    if (!bot) {
      throw invalid(`No bot named ${selection.bot}.`)
    }
    return [bot]
  }
  if (bots.length === 0) {
    throw invalid('No bots.')
  }
  return [...bots]
}

const workspaceLabel = (workspace: { name?: string; workspaceName?: string; urlKey?: string }) =>
  workspace.urlKey || workspace.name || workspace.workspaceName || ''

function linearLink(workspace: ConnectorLinearWorkspace): BotLinear {
  return {
    workspaceId: workspace.workspaceId,
    workspaceName: workspace.name,
    urlKey: workspace.urlKey
  }
}

function planLinear(bot: Bot, read: HostRead<ConnectorLinearState>, plan: BotConnectPlan): void {
  if (!read.ok) {
    plan.notes.push(`Linear not read on this computer: ${read.message}`)
    return
  }
  const { workspaces } = read.state
  if (workspaces.length === 0) {
    plan.notes.push(
      "Linear is not connected on this computer; connect it once from a bot's Connectors in Orca"
    )
    return
  }
  const current = botLinearWorkspaces(bot)
  const has = new Set(current.map((entry) => entry.workspaceId))
  for (const workspace of workspaces) {
    if (!workspace.installed && !has.has(workspace.workspaceId)) {
      plan.notes.push(
        `Linear ${workspaceLabel(workspace)}: Orca's Linear app is not installed there yet`
      )
    }
  }
  const already = current.filter((entry) =>
    workspaces.some((workspace) => workspace.workspaceId === entry.workspaceId)
  )
  if (already.length > 0) {
    plan.notes.push(`Linear ${already.map(workspaceLabel).join(', ')} already linked`)
  }
  const room = BOT_MAX_CONNECTOR_WORKSPACES - current.length
  const missing = workspaces.filter(
    (workspace) => workspace.installed && !has.has(workspace.workspaceId)
  )
  const adding = missing.slice(0, Math.max(0, room))
  for (const workspace of missing.slice(adding.length)) {
    plan.notes.push(
      `Linear ${workspaceLabel(workspace)}: the bot is in ${BOT_MAX_CONNECTOR_WORKSPACES} workspaces already`
    )
  }
  if (adding.length > 0) {
    // Its own workspaces keep their place (and the account each was linked under); new ones go last.
    plan.updates.linearWorkspaces = [...current, ...adding.map(linearLink)]
    plan.linked.push(...adding.map((workspace) => `Linear ${workspaceLabel(workspace)}`))
  }
}

function planGitHub(bot: Bot, read: HostRead<ConnectorGitHubState>, plan: BotConnectPlan): void {
  if (bot.github) {
    plan.notes.push('GitHub already linked')
    return
  }
  if (!read.ok) {
    plan.notes.push(`GitHub not read on this computer: ${read.message}`)
    return
  }
  const { account, installations } = read.state
  if (!account) {
    plan.notes.push(
      "GitHub is not connected on this computer; connect it once from a bot's Connectors in Orca"
    )
    return
  }
  if (installations.length === 0) {
    plan.notes.push(`GitHub ${account.login}: the Orca GitHub app is not installed anywhere yet`)
    return
  }
  // As the setup's Turn on: the bot answers in every installation the account can see.
  plan.updates.github = {}
  plan.linked.push(`GitHub ${account.login}`)
}

/** What each bot gets, from the host's links; nothing here calls the host. */
export function planBotConnect(
  bots: readonly Bot[],
  wants: BotConnectWants,
  reads: {
    linear?: HostRead<ConnectorLinearState>
    github?: HostRead<ConnectorGitHubState>
  }
): BotConnectPlan[] {
  return bots.map((bot) => {
    const plan: BotConnectPlan = { bot, updates: {}, linked: [], notes: [] }
    if (wants.linear && reads.linear) {
      planLinear(bot, reads.linear, plan)
    }
    if (wants.github && reads.github) {
      planGitHub(bot, reads.github, plan)
    }
    return plan
  })
}

export function formatBotConnectResult(result: BotConnectResult): string {
  return result.bots
    .map((row) => {
      const parts = [
        ...(row.linked.length > 0 ? [`linked ${row.linked.join(', ')}`] : ['nothing linked']),
        ...row.notes
      ]
      return `${row.name}: ${parts.join('; ')}`
    })
    .join('\n')
}

/** The host's answer as the setup reads it: the cloud's value, or its code (signed_out, linear_off, ...). */
export function hostReadOf<T>(answer: BotSlackResult<T>): HostRead<T> {
  return answer.ok ? { ok: true, state: answer.value } : { ok: false, message: answer.error }
}

async function readHost<T>(
  read: () => Promise<{ result: BotSlackResult<T> }>
): Promise<HostRead<T>> {
  try {
    return hostReadOf((await read()).result)
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export const FORK_BOT_CONNECT_HANDLERS: Record<string, CommandHandler> = {
  'bot connect': async (ctx) => {
    const wants = readBotConnectWants(ctx.flags)
    // bots.list is the asked host's own bots: a paired server's bots never come with --all.
    const listed = await ctx.client.call<BotsListResult>('bots.list')
    const chosen = selectBotsToConnect(listed.result.bots, {
      bot: getOptionalStringFlag(ctx.flags, 'bot'),
      all: ctx.flags.has('all')
    })
    const [linear, github] = await Promise.all([
      wants.linear
        ? readHost(() => ctx.client.call<BotSlackResult<ConnectorLinearState>>('bots.linear.state'))
        : undefined,
      wants.github
        ? readHost(() => ctx.client.call<BotSlackResult<ConnectorGitHubState>>('bots.github.state'))
        : undefined
    ])
    const rows: BotConnectRow[] = []
    for (const plan of planBotConnect(chosen, wants, { linear, github })) {
      const row = {
        id: plan.bot.id,
        name: plan.bot.name,
        linked: plan.linked,
        notes: plan.notes
      }
      if (Object.keys(plan.updates).length > 0) {
        try {
          await ctx.client.call<{ bot: Bot }>('bots.update', {
            botId: plan.bot.id,
            updates: plan.updates
          })
        } catch (error) {
          row.notes = [
            ...row.notes,
            `not saved: ${error instanceof Error ? error.message : String(error)}`
          ]
          row.linked = []
        }
      }
      rows.push(row)
    }
    printResult({ ...listed, result: { bots: rows } }, ctx.json, formatBotConnectResult)
  }
}
