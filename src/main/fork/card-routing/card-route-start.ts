// Card routing (BAD-694, FORK.md): `fork.cardRoute.start` starts a card's chat on the bot that takes
// it, acting for the owner as the owner's own new chat does, titled "KEY: summary", and says which
// chat and machine it is, so the caller can follow it.
import { forkPauseAllRefusal } from '../pause-all/pause-all-state'
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import type * as z from 'zod'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { requireStructuredHost, startBotSession } from '../../bots/bot-chat-session'
import type { Bot } from '../../../shared/bot-types'
import { OWNER_ACTS_FOR } from '../../../shared/bots/bot-acts-for'
import { botOfAddress } from '../../../shared/bot-roster'
import type {
  ForkCardRouteStartParams,
  ForkCardRouteStartResult
} from '../../../shared/fork/card-routing'

export class CardRouteStartError extends Error {}

export type CardRouteStartDeps<B extends Pick<Bot, 'id' | 'name' | 'paused'>> = {
  botsEnabled: () => boolean
  listBots: () => readonly B[]
  startChat: (bot: B, message: string) => Promise<string>
  nameChat: (chatId: string, title: string) => Promise<void>
  machine: () => string
}

/** This computer's short name, as a person calls it (m5mac, not m5mac.local). */
export function shortHostName(name = hostname()): string {
  return name.replace(/\.(local|lan|home|localdomain)$/i, '') || name
}

export async function startCardChat<B extends Pick<Bot, 'id' | 'name' | 'paused'>>(
  deps: CardRouteStartDeps<B>,
  params: z.infer<typeof ForkCardRouteStartParams>
): Promise<ForkCardRouteStartResult> {
  if (!deps.botsEnabled()) {
    throw new CardRouteStartError('Bots are off on this computer. Turn them on in Settings > Bots.')
  }
  // Pause all (BAD-685, FORK.md): a routed card is unattended work; it starts nothing while paused.
  const paused = forkPauseAllRefusal()
  if (paused) {
    throw new CardRouteStartError(paused)
  }
  const bot = botOfAddress(deps.listBots(), params.bot)
  if (!bot) {
    throw new CardRouteStartError(`No bot named ${params.bot} on ${deps.machine()}.`)
  }
  if (bot.paused) {
    throw new CardRouteStartError(
      `${bot.name} is paused. Resume it in Bots, then route the card again.`
    )
  }
  const chatId = await deps.startChat(bot, params.message)
  // The message is already in: a failed rename must not lose the chat id.
  await deps
    .nameChat(chatId, params.subject)
    .catch((error: unknown) => console.warn('[card-route] could not title the card chat', error))
  return { bot: bot.name, chatId, machine: deps.machine() }
}

export function runtimeCardChatStart(runtime: OrcaRuntimeService) {
  return (params: z.infer<typeof ForkCardRouteStartParams>) =>
    startCardChat<Bot>(
      {
        botsEnabled: () => runtime.bots.enabled(),
        listBots: () => runtime.bots.list(),
        startChat: (bot, message) =>
          startBotSession(runtime, bot, {
            message: { text: message, clientMessageId: randomUUID() },
            actsFor: { actsFor: [...OWNER_ACTS_FOR] }
          }),
        nameChat: async (chatId, title) => {
          await (
            await requireStructuredHost(runtime)
          ).setUserConversationName(chatId, title, 'rename')
        },
        machine: () => shortHostName()
      },
      params
    )
}
