// BAD-833: what the goal loop's send answers for each reason the terminal gate gives. Faked: the gate.
import { describe, expect, it, vi } from 'vitest'
import type { IdleRecoveryPorts } from '../idle-recovery/idle-recovery-ports'
import { sendGoalText } from './goal-send'

function sendWith(refusal: string | null) {
  const send = vi.fn(async () => 'sent')
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a terminal send reads only these.
  const ports = {
    terminal: { bind: () => ({ handle: 'term_1' }), refusal: async () => refusal, send },
    chat: {}
  } as unknown as IdleRecoveryPorts
  const answer = sendGoalText(
    { chatId: 'tab:leaf', kind: 'terminal', agent: 'claude', idleSince: 1 },
    'go on',
    ports
  )
  return { answer, send }
}

describe('a goal continue message to a terminal', () => {
  it.each(['unsettled', 'restoring'])('waits on %s and sends nothing', async (reason) => {
    const { answer, send } = sendWith(reason)
    expect(await answer).toBe('wait')
    expect(send).not.toHaveBeenCalled()
  })

  it.each(['draft', 'prompt', 'overlay', 'no-terminal'])('is refused on %s', async (reason) => {
    expect(await sendWith(reason).answer).toBe(false)
  })

  it('is sent when nothing holds it', async () => {
    const { answer, send } = sendWith(null)
    expect(await answer).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
  })
})
