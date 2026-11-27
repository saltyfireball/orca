// BAD-635 (FORK.md "Bot model from the CLI"): `orca bot set`, through bots.list and bots.update,
// the calls a bot's settings make. Agents may run it: a model is a cost choice, not a limit on what
// a bot may do, and bots.update already lets the local CLI change a bot's launch.
import type { Bot } from '../../shared/bot-types'
import type { BotLaunch } from '../../shared/bots/bot-launch'
import {
  describeForkBotLaunch,
  forkBotLaunchAfter,
  type ForkBotLaunchChange
} from '../../shared/fork/launch-defaults/launch-defaults-bot'
import type { CommandHandler } from '../dispatch/dispatch'
import { getOptionalStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import type { BotsListResult } from '../bots/bot'
import { readForkBotAgentPick, type ForkBotAgentPick } from './custom-acp-bot-agent'

export type BotSetRow = {
  id: string
  name: string
  agent: string
  /** BAD-873: the custom ACP agent a `custom-acp` bot runs. */
  customAcpAgent?: string
  launch: BotLaunch | null
}
export type BotSetResult = { bots: BotSetRow[] }

type Selection = { bot?: string; all: boolean; agent?: string }

function invalid(message: string): RuntimeClientError {
  return new RuntimeClientError('invalid_argument', message)
}

/** Which bots the flags name; throws on none, both or a model across agents. */
export function selectBotsToSet(
  bots: readonly Bot[],
  selection: Selection,
  change: ForkBotLaunchChange
): Bot[] {
  if (Boolean(selection.bot) === selection.all) {
    throw invalid('Name one bot with --bot <name>, or every bot with --all.')
  }
  let chosen: Bot[]
  if (selection.bot) {
    const key = selection.bot.toLowerCase()
    const bot =
      bots.find((entry) => entry.id === selection.bot) ??
      bots.find((entry) => entry.name.toLowerCase() === key)
    if (!bot) {
      throw invalid(`No bot named ${selection.bot}.`)
    }
    chosen = [bot]
  } else {
    chosen = selection.agent ? bots.filter((bot) => bot.agent === selection.agent) : [...bots]
    if (chosen.length === 0) {
      throw invalid(selection.agent ? `No ${selection.agent} bots.` : 'No bots.')
    }
  }
  const agents = new Set(chosen.map((bot) => bot.agent))
  if (change.model && agents.size > 1) {
    throw invalid(
      `A model belongs to one agent and these bots run ${[...agents].join(', ')}. Add --agent <agent>.`
    )
  }
  return chosen
}

export function readBotLaunchChange(flags: Map<string, string | boolean>): ForkBotLaunchChange {
  const model = getOptionalStringFlag(flags, 'model')?.trim() || undefined
  const effort = getOptionalStringFlag(flags, 'effort')?.trim() || undefined
  const clear = flags.has('clear')
  if (clear && (model || effort)) {
    throw invalid('--clear removes the model and effort; leave out --model and --effort.')
  }
  if (!clear && !model && !effort) {
    throw invalid('Say what to set: --model <id>, --effort <level> or --clear.')
  }
  return clear ? { clear } : { ...(model ? { model } : {}), ...(effort ? { effort } : {}) }
}

export function formatBotSetResult(result: BotSetResult): string {
  return result.bots
    .map(
      (bot) =>
        `${bot.name} (${bot.customAcpAgent ?? bot.agent}): ${describeForkBotLaunch(bot.launch)}`
    )
    .join('\n')
}

const LAUNCH_FLAGS = ['model', 'effort', 'clear']

/** The update for one bot: its new agent when --bot names one, and its launch when a change is
 *  asked; a new agent starts from no launch, since a model belongs to its agent. */
function botSetUpdates(
  bot: Bot,
  pick: ForkBotAgentPick | null,
  change: ForkBotLaunchChange | null
): Record<string, unknown> {
  const launch = change ? forkBotLaunchAfter(pick ? undefined : bot.launch, change) : undefined
  return { ...pick, ...(launch !== undefined ? { launch } : {}) }
}

export const FORK_BOT_SET_HANDLERS: Record<string, CommandHandler> = {
  'bot set': async (ctx) => {
    // BAD-873: with --bot, --agent moves the bot to that agent, a custom ACP agent's name too.
    const agentFlag = getOptionalStringFlag(ctx.flags, 'agent')
    const pick =
      ctx.flags.has('bot') && agentFlag ? await readForkBotAgentPick(ctx, agentFlag) : null
    const launchAsked = LAUNCH_FLAGS.some((flag) => ctx.flags.has(flag))
    const change = pick && !launchAsked ? null : readBotLaunchChange(ctx.flags)
    if (pick?.agent === 'custom-acp' && change) {
      throw invalid(
        `${agentFlag} is a custom ACP agent, which picks its own model; leave out --model, --effort and --clear.`
      )
    }
    const listed = await ctx.client.call<BotsListResult>('bots.list')
    const chosen = selectBotsToSet(
      listed.result.bots,
      {
        bot: getOptionalStringFlag(ctx.flags, 'bot'),
        all: ctx.flags.has('all'),
        agent: pick ? undefined : agentFlag
      },
      change ?? {}
    )
    // Each launch is checked before any is saved, so a bad choice changes no bot.
    const planned = chosen.map((bot) => {
      try {
        return { bot, updates: botSetUpdates(bot, pick, change) }
      } catch (error) {
        throw invalid(`${bot.name}: ${error instanceof Error ? error.message : String(error)}`)
      }
    })
    const rows: BotSetRow[] = []
    for (const { bot, updates } of planned) {
      const saved = await ctx.client.call<{ bot: Bot }>('bots.update', { botId: bot.id, updates })
      rows.push({
        id: bot.id,
        name: saved.result.bot.name,
        agent: saved.result.bot.agent,
        ...(saved.result.bot.customAcpAgent
          ? { customAcpAgent: saved.result.bot.customAcpAgent }
          : {}),
        launch: saved.result.bot.launch ?? null
      })
    }
    printResult({ ...listed, result: { bots: rows } }, ctx.json, formatBotSetResult)
  }
}
