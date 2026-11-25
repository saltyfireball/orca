// Pause all over the automatic chat handoff on a usage limit (BAD-818, FORK.md "Pause all"). With
// `forkChatHandoffOnLimit` set to 'auto', a parked chat would start the other agent on its own;
// while the switch is engaged (or unreadable) it is held instead, and resume-all hands off the
// stops still parked then, once. Limit resume keeps the chat parked meanwhile.
import { forkPauseAllRefusal } from './pause-all-state'

/** True while paused: the due handoffs wait, and why is logged here. */
export function forkPauseAllHoldsLimitHandoff(count: number): boolean {
  const reason = forkPauseAllRefusal()
  if (reason === null) {
    return false
  }
  console.info('[fork-pause-all] automatic chat handoffs on a usage limit are held', {
    count,
    reason
  })
  return true
}
