// Goal loop (BAD-682, FORK.md): sends the loop's text to an agent whose turn has ended, the way
// idle recovery's wake does (`idle-recovery-wake.ts`): never to a chat that is asleep, in a turn,
// or (a terminal) holds typed text or a dialog; idleness is read before the send and again right
// before it. A send that failed after it may have reached the agent counts as taken, so a message
// is never sent twice. 'wait': the terminal's state cannot be told yet, so nothing was tried.
import { idleRecoveryPorts, type IdleRecoveryPorts } from '../idle-recovery/idle-recovery-ports'
import type { IdleRecoveryCandidate } from '../idle-recovery/idle-recovery-types'

type Target = Pick<IdleRecoveryCandidate, 'chatId' | 'kind' | 'agent' | 'idleSince'>

export async function sendGoalText(
  target: Target,
  text: string,
  ports: IdleRecoveryPorts = idleRecoveryPorts()
): Promise<boolean | 'wait'> {
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
  const refusal = (): Promise<string | null> =>
    // The loop lists only agents the status store shows idle, so "no live status yet" is not a veto.
    ports.terminal.refusal(chatId, bound.handle, target.idleSince, { acceptUnverified: true })
  const first = await refusal()
  if (first !== null) {
    return CANNOT_TELL.has(first) ? 'wait' : false
  }
  const clear = async (): Promise<boolean> => (await refusal()) === null
  return (await ports.terminal.send(bound, target.agent, text, clear)) !== 'refused'
}

/** BAD-833: the terminal gate has no verdict yet (a pane a restart reattached, whose agent has not
 *  been seen at rest since, or a screen still restoring): the goal waits, it is not a failed send. */
const CANNOT_TELL: ReadonlySet<string> = new Set(['unsettled', 'restoring'])
