// Who an owner-panel write is: the owner on this computer, or a paired phone; an agent's CLI is refused.
import type { BotItemOwnerActor } from '../../../bots/bot-items-input'
import type { RpcContext } from '../core'
import { ownerOnly } from './bots-caller-gates'

const REFUSAL = 'Only your owner changes items this way, in Orca.'

export function ownerActor(context: RpcContext): BotItemOwnerActor {
  ownerOnly(context, REFUSAL)
  context.runtime.bots.assertEnabled()
  return context.pairedDeviceId
    ? { kind: 'owner', device: context.pairedDeviceId }
    : { kind: 'owner' }
}
