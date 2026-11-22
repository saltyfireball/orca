// Idle recovery (FORK.md), item D: the two ways it sends to a chat.
// Contract: a wake goes out only after `decideIdleRecoveryWake` said 'wake', as
// `buildIdleRecoveryWakeMessage(nextStep)`, and resolves true only when the chat took it. An
// answer is the user's own text, sent unchanged to a chat that is waiting on the user. Both use
// the app's normal send for that kind of chat.
// A wake is never sent to a chat that is asleep, in a turn, or (a terminal) holds typed text or
// a dialog: idleness is read before the send and again right before the message goes. A terminal
// the user typed into since its turn ended is not woken either: the screen reader knows only
// some agents' composers, and keys nobody can see on screen may still sit in the others. A send
// that failed after it may have reached the chat counts as taken, so it is never sent twice.
import {
  buildIdleRecoveryWakeMessage,
  type IdleRecoveryChatKind
} from '../../../shared/fork/idle-recovery'
import type { ForkIdleRecoveryAnswerOutcome } from '../../../shared/fork/idle-recovery-wire'
import { isForkPauseAllEngaged } from '../pause-all/pause-all-state'
import {
  idleRecoveryPorts,
  type IdleRecoveryChatFacts,
  type IdleRecoveryPorts,
  type IdleRecoverySendOutcome
} from './idle-recovery-ports'
import type { IdleRecoveryCandidate } from './idle-recovery-types'

function mayWakeChat(facts: IdleRecoveryChatFacts | null): facts is IdleRecoveryChatFacts {
  return facts !== null && facts.loaded && !facts.inTurn
}

function taken(outcome: IdleRecoverySendOutcome): boolean {
  return outcome !== 'refused'
}

export async function sendIdleRecoveryWake(
  candidate: Pick<IdleRecoveryCandidate, 'chatId' | 'kind' | 'agent' | 'idleSince'>,
  nextStep: string,
  ports: IdleRecoveryPorts = idleRecoveryPorts()
): Promise<boolean> {
  if (!nextStep.trim() || isForkPauseAllEngaged()) {
    // Pause all (BAD-685, FORK.md): no wake is sent while the switch is engaged.
    return false
  }
  const text = buildIdleRecoveryWakeMessage(nextStep)
  const { chatId } = candidate
  if (candidate.kind === 'chat') {
    const facts = ports.chat.read(chatId)
    if (!mayWakeChat(facts)) {
      return false
    }
    return taken(
      await ports.chat.send(chatId, text, facts.fence, () => mayWakeChat(ports.chat.read(chatId)))
    )
  }
  const bound = ports.terminal.bind(chatId)
  if (!bound) {
    return false
  }
  const clear = async (): Promise<boolean> =>
    (await ports.terminal.refusal(chatId, bound.handle, candidate.idleSince)) === null
  if (!(await clear())) {
    return false
  }
  return taken(await ports.terminal.send(bound, candidate.agent, text, clear))
}

/** What the inbox knows of the chat; without it the kind is read from the host. */
export type IdleRecoveryAnswerTarget = { kind: IdleRecoveryChatKind; agent: string }

export async function sendIdleRecoveryAnswer(
  chatId: string,
  text: string,
  target?: IdleRecoveryAnswerTarget,
  ports: IdleRecoveryPorts = idleRecoveryPorts()
): Promise<ForkIdleRecoveryAnswerOutcome> {
  const facts = target?.kind === 'terminal' ? null : ports.chat.read(chatId)
  if (facts) {
    // As a person's message is: a chat that got busy holds it as a card.
    return taken(await ports.chat.send(chatId, text, facts.fence)) ? 'sent' : 'unavailable'
  }
  if (target?.kind === 'chat') {
    return 'not-found'
  }
  const bound = ports.terminal.bind(chatId)
  if (!bound) {
    return 'not-found'
  }
  if (!target) {
    // Typing into a terminal needs proof of which agent reads it.
    return 'unavailable'
  }
  const refusal = await ports.terminal.refusal(chatId, bound.handle)
  if (refusal !== null) {
    return refusal === 'in-turn' ? 'not-waiting' : 'unavailable'
  }
  const outcome = await ports.terminal.send(
    bound,
    target.agent,
    text,
    async () => (await ports.terminal.refusal(chatId, bound.handle)) === null
  )
  return taken(outcome) ? 'sent' : 'unavailable'
}
