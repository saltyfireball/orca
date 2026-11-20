// Quick task (SLRM-2428, FORK.md): the service bound to this Orca's bots. The router is made the
// way the owner's New bot makes one (its purpose seeded into SOUL.md, no greeting turn), and each
// task starts a new chat on it acting for the owner, as the owner's own new chat would.
import { randomUUID } from 'node:crypto'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { startBotSession } from '../../bots/bot-chat-session'
import { botOfSession } from '../../bots/bot-session-tabs'
import { assertBotAgentRunsOnThisHost } from '../../bots/bot-agent-host-refusal'
import { BOT_ORCA_CLI } from '../../bots/bot-preamble'
import { BotLaunchSchema } from '../../../shared/bots/bot-launch'
import { BOT_AGENTS, type Bot, type BotAgent } from '../../../shared/bot-types'
import { OWNER_ACTS_FOR } from '../../../shared/bots/bot-acts-for'
import { folderWorkspaceKey } from '../../../shared/workspace/identity/workspace-scope'
import type { QuickTaskSubmitResult } from '../../../shared/fork/quick-task-contract'
import { readForkQuickTaskConfig } from '../../../shared/fork/quick-task'
import {
  findQuickTaskRouter,
  QuickTaskError,
  quickTaskService,
  type QuickTaskRouterInput
} from './quick-task-service'

function isBotAgent(value: string): value is BotAgent {
  return (BOT_AGENTS as readonly string[]).includes(value)
}

async function createRouter(runtime: OrcaRuntimeService, input: QuickTaskRouterInput) {
  if (!isBotAgent(input.agent)) {
    throw new QuickTaskError(
      `The router's agent must be one of ${BOT_AGENTS.join(', ')}, not ${input.agent}.`
    )
  }
  assertBotAgentRunsOnThisHost(input.agent)
  const launch = input.model ? BotLaunchSchema.safeParse({ model: input.model }) : null
  if (launch && !launch.success) {
    console.warn(
      `[quick-task] ${input.agent} does not take model ${input.model}; using its default`
    )
  }
  return runtime.bots.create({
    name: input.name,
    agent: input.agent,
    ...(launch?.success ? { launch: launch.data } : {}),
    seed: { purpose: input.purpose, does: input.does }
  })
}

const services = new WeakMap<
  OrcaRuntimeService,
  { submit: (params: unknown) => Promise<QuickTaskSubmitResult> }
>()

/** One service per runtime, so its queue covers the box, the phone and the CLI together. */
export function runtimeQuickTask(runtime: OrcaRuntimeService): {
  submit: (params: unknown) => Promise<QuickTaskSubmitResult>
} {
  let service = services.get(runtime)
  if (!service) {
    service = quickTaskService<Bot>({
      settings: () => runtime.requireStore().getSettings(),
      botsEnabled: () => runtime.bots.enabled(),
      listBots: () => runtime.bots.list(),
      createRouter: (input) => createRouter(runtime, input),
      startChat: (bot, message) =>
        startBotSession(runtime, bot, {
          message: { text: message, clientMessageId: randomUUID() },
          actsFor: { actsFor: [...OWNER_ACTS_FOR] }
        }),
      cli: BOT_ORCA_CLI
    })
    services.set(runtime, service)
  }
  return service
}

/** Shows a chat the box started, in the main window; false when it is not the router's. */
export async function openQuickTaskChat(
  runtime: OrcaRuntimeService,
  chatId: string
): Promise<boolean> {
  const config = readForkQuickTaskConfig(runtime.requireStore().getSettings())
  const bot = findQuickTaskRouter(runtime.bots.list(), config.routerBot)
  if (!bot || botOfSession(runtime.bots, chatId)?.id !== bot.id) {
    return false
  }
  await runtime.publishStructuredAgentSessionTab({
    workspaceId: folderWorkspaceKey(bot.folderWorkspaceId),
    sessionId: chatId,
    agent: bot.agent,
    activate: true
  })
  return true
}
