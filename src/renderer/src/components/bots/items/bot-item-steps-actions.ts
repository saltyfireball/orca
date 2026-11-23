// Fork BAD-747: the owner's marks on an item's steps. Only the owner's panel makes them (the host refuses
// an agent's CLI), and the last tick mails the bot's chat once for all of them.
import { callBotRpc, type BotRef } from '@/lib/bot-hosts'
import type { BotItem } from '../../../../../shared/bots/bot-items'
import type { BotItemStep, BotItemStepState } from '../../../../../shared/bots/bot-item-steps'

export function markBotItemStep(
  bot: BotRef,
  item: Pick<BotItem, 'uid' | 'steps'>,
  step: Pick<BotItemStep, 'index'>,
  state: BotItemStepState,
  error?: string
): Promise<unknown> {
  return callBotRpc(bot, 'bots.items.owner.step', {
    item: item.uid,
    set: item.steps?.eventId ?? '',
    index: step.index,
    state,
    ...(error ? { error } : {})
  })
}
