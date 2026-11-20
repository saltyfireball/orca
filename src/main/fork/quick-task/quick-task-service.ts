// Quick task (SLRM-2428, FORK.md): `quickTask.submit`, the one path the box, the phone and
// `orca quick-task` take. The task goes to the router bot (made on first use) as the first message
// of a new chat, the way the owner starts a bot chat; the router hands it on with a handoff.
import {
  QUICK_TASK_TEXT_MAX,
  type QuickTaskSubmitParams,
  type QuickTaskSubmitResult
} from '../../../shared/fork/quick-task-contract'
import {
  FORK_QUICK_TASK_ROUTER_PURPOSE,
  QuickTaskSubmitParamsSchema,
  readForkQuickTaskConfig
} from '../../../shared/fork/quick-task'
import { QUICK_TASK_ROUTER_DOES, quickTaskRouterBrief } from './quick-task-brief'

export type QuickTaskBot = { id: string; name: string; paused: boolean }

export type QuickTaskRouterInput = {
  name: string
  agent: string
  model: string | null
  purpose: string
  does: string
}

export type QuickTaskServiceDeps<B extends QuickTaskBot = QuickTaskBot> = {
  settings: () => unknown
  botsEnabled: () => boolean
  listBots: () => readonly B[]
  createRouter: (input: QuickTaskRouterInput) => Promise<B>
  /** Starts a new chat on the bot with this first message; resolves to its session id. */
  startChat: (bot: B, message: string) => Promise<string>
  /** The orca command as a bot's shell runs it. */
  cli: string
}

export class QuickTaskError extends Error {}

/** The bot a name means, as `bot:<name>` does: by name in any case. */
export function findQuickTaskRouter<B extends QuickTaskBot>(
  bots: readonly B[],
  name: string
): B | null {
  const key = name.toLowerCase()
  return bots.find((bot) => bot.name.toLowerCase() === key) ?? null
}

/** Reads the request as the RPC would, so the box and the CLI get the same refusals. */
export function parseQuickTaskParams(params: unknown): QuickTaskSubmitParams {
  const parsed = QuickTaskSubmitParamsSchema.safeParse(params)
  if (!parsed.success) {
    throw new QuickTaskError(
      `A quick task is 1 to ${QUICK_TASK_TEXT_MAX} characters of text from desktop, mobile or cli.`
    )
  }
  return parsed.data
}

export function quickTaskService<B extends QuickTaskBot>(deps: QuickTaskServiceDeps<B>) {
  // One at a time, so two tasks sent at once cannot each make a router.
  let queue: Promise<unknown> = Promise.resolve()

  const router = async (name: string, agent: string, model: string | null): Promise<B> => {
    const found = findQuickTaskRouter(deps.listBots(), name)
    if (found) {
      return found
    }
    return deps.createRouter({
      name,
      agent,
      model,
      purpose: FORK_QUICK_TASK_ROUTER_PURPOSE,
      does: QUICK_TASK_ROUTER_DOES
    })
  }

  const send = async (request: QuickTaskSubmitParams): Promise<QuickTaskSubmitResult> => {
    const config = readForkQuickTaskConfig(deps.settings())
    if (!config.enabled) {
      throw new QuickTaskError(
        'Quick task is off. Turn it on in Settings > Blackfish > Chats > Quick task.'
      )
    }
    if (!deps.botsEnabled()) {
      throw new QuickTaskError('Bots are off on this computer. Turn them on in Settings > Bots.')
    }
    const bot = await router(config.routerBot, config.routerAgent, config.routerModel)
    if (bot.paused) {
      throw new QuickTaskError(
        `${bot.name} is paused. Resume it in Bots, then send the task again.`
      )
    }
    const chatId = await deps.startChat(
      bot,
      quickTaskRouterBrief({
        text: request.text,
        source: request.source,
        placementCommand: config.placementCommand,
        cli: deps.cli
      })
    )
    return {
      botName: bot.name,
      chatId,
      note: `${bot.name} is finding the bot that owns it${config.placementCommand ? ' and a machine to run it on' : ''}.`
    }
  }

  return {
    submit(params: unknown): Promise<QuickTaskSubmitResult> {
      let request: QuickTaskSubmitParams
      try {
        request = parseQuickTaskParams(params)
      } catch (error) {
        return Promise.reject(error)
      }
      const run = queue.then(() => send(request))
      queue = run.catch(() => undefined)
      return run
    }
  }
}
