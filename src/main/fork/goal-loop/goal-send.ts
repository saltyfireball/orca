// Goal loop (BAD-682, FORK.md): sends the loop's text to an agent whose turn has ended, the way
// idle recovery's wake does (`idle-recovery-wake.ts`): never to a chat that is asleep, in a turn,
// or (a terminal) holds typed text or a dialog; idleness is read before the send and again right
// before it. A send that failed after it may have reached the agent counts as taken, so a message
// is never sent twice.
import { idleRecoveryPorts, type IdleRecoveryPorts } from '../idle-recovery/idle-recovery-ports'
import type { IdleRecoveryCandidate } from '../idle-recovery/idle-recovery-types'

type Target = Pick<IdleRecoveryCandidate, 'chatId' | 'kind' | 'agent' | 'idleSince'>

export async function sendGoalText(
  target: Target,
  text: string,
  ports: IdleRecoveryPorts = idleRecoveryPorts()
): Promise<boolean> {
  const { chatId } = target
  if (target.kind === 'chat') {
    const facts = ports.chat.read(chatId)
    const idle = (): boolean => {
      const now = ports.chat.read(chatId)
      return now !== null && now.loaded && !now.inTurn
    }
    if (!facts || !idle()) {
      return false
    }
    return (await ports.chat.send(chatId, text, facts.fence, idle)) !== 'refused'
  }
  const bound = ports.terminal.bind(chatId)
  if (!bound) {
    return false
  }
  const clear = async (): Promise<boolean> =>
    (await ports.terminal.refusal(chatId, bound.handle, target.idleSince)) === null
  if (!(await clear())) {
    return false
  }
  return (await ports.terminal.send(bound, target.agent, text, clear)) !== 'refused'
}
