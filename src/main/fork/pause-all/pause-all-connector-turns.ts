// Pause all over inbound connector turns (BAD-818, FORK.md "Pause all"). A person's message to a bot
// through a connector (a mention, a DM, a comment addressed to it) that would start or continue a
// turn is refused while the switch is engaged (or unreadable). It cannot be held: the cloud resends
// an unconfirmed delivery only until its deadline, and its refusal has no free text, so it is
// refused as `bot_paused`, which the cloud tells the asker. The delivery's receipt keeps the
// refusal, so a resend after resume-all is not run either. A Stop, or an answer to a running turn's
// prompt, still goes through; an event that only starts an automation is skipped by the automation
// gate.
import type { ConversationKey } from '../../external-conversations/external-conversation-types'
import { forkPauseAllRefusal } from './pause-all-state'

/** True while paused: the delivery is refused, and why is logged here. */
export function forkPauseAllRefusesConnectorTurn(key: ConversationKey, botId: string): boolean {
  const reason = forkPauseAllRefusal()
  if (reason === null) {
    return false
  }
  console.info('[fork-pause-all] a connector message to a bot is refused', {
    source: key.source,
    botId,
    reason
  })
  return true
}
