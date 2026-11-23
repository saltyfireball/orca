// `bots.items.owner.step` (BAD-747): see FORK.md, Owner steps.
import { botItemEventId, parseBotItemEventId } from '../../../../shared/bots/bot-items'
import { BotItemsOwnerStep } from '../../../../shared/rpc-contract/bots-items-params'
import {
  readForkBotOwnerStepsAutoAnswer,
  type ForkBotOwnerStepsSettings
} from '../../../../shared/fork/bot-owner-steps'
import { BotItemError } from '../../../bots/bot-item-error'
import { defineMethod } from '../core'
import { ownerActor } from './bots-items-owner-actor'
import { resolveItem } from './bots-items-write-support'

// Fork BAD-747: the owner's marks on an item's steps. Only the owner's panel, desktop or phone: the
// same check as quick replies, so an agent's CLI is refused.
export const STEP = defineMethod({
  name: 'bots.items.owner.step',
  permission: 'workspace',
  params: BotItemsOwnerStep,
  handler: async (params, context) => {
    const actor = ownerActor(context)
    const { botItems } = context.runtime
    const store = botItems.store()
    const item = await resolveItem(store, params.item)
    const set = parseBotItemEventId(params.set)
    if (set === null) {
      throw new BotItemError('invalid_argument', 'set takes an event id such as e41.')
    }
    const outcome = await store.ownerStep(
      item.uid,
      {
        set,
        index: params.index,
        state: params.state,
        ...(params.error !== undefined ? { error: params.error } : {}),
        autoAnswer: readForkBotOwnerStepsAutoAnswer(
          context.runtime.requireStore().getSettings() as ForkBotOwnerStepsSettings
        )
      },
      actor
    )
    botItems.changed([item])
    // The mark is stored and its mail, when it owes one, is stored with it: never wait on the chat.
    void botItems
      .sendOwedMail()
      .catch((error: unknown) => console.warn('[bots] items: mailing a step failed', error))
    return {
      eventId: outcome.eventId === null ? null : botItemEventId(outcome.eventId),
      completed: outcome.completed,
      answered: outcome.answered
    }
  }
})
