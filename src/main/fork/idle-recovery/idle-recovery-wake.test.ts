import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDLE_RECOVERY_WAKE_MARKER, isWakePrompt } from '../../../shared/fork/idle-recovery'
import {
  idleRecoveryTerminalPort,
  type IdleRecoveryChatFacts,
  type IdleRecoveryPorts,
  type IdleRecoverySendOutcome,
  type IdleRecoveryTerminalRuntime
} from './idle-recovery-ports'
import { sendIdleRecoveryAnswer, sendIdleRecoveryWake } from './idle-recovery-wake'

const pause = vi.hoisted(() => ({ engaged: false }))
vi.mock('../pause-all/pause-all-state', () => ({
  isForkPauseAllEngaged: () => pause.engaged,
  forkPauseAllRefusal: () => (pause.engaged ? 'Paused by pause-all: test' : null),
  onForkPauseAllChanged: () => () => {}
}))
afterEach(() => {
  pause.engaged = false
})

function fakePorts() {
  const fake = {
    chat: { fence: 3, loaded: true, inTurn: false } as IdleRecoveryChatFacts | null,
    /** What the chat looks like by the time the host is about to send. */
    chatAtSend: undefined as IdleRecoveryChatFacts | null | undefined,
    bound: true,
    refusals: [] as (string | null)[],
    /** The `untouchedSince` each terminal check was asked with. */
    untouchedSince: [] as (number | undefined)[],
    outcome: 'sent' as IdleRecoverySendOutcome,
    sent: [] as { to: string; text: string; via: 'chat' | 'terminal' }[],
    ports: {} as IdleRecoveryPorts
  }
  let reads = 0
  fake.ports = {
    chat: {
      read: () => {
        reads += 1
        return reads > 1 && fake.chatAtSend !== undefined ? fake.chatAtSend : fake.chat
      },
      send: async (to, text, _fence, stillIdle) => {
        if (stillIdle && !stillIdle()) {
          return 'refused'
        }
        fake.sent.push({ to, text, via: 'chat' })
        return fake.outcome
      }
    },
    terminal: {
      bind: () =>
        fake.bound ? { handle: 'h1', binding: { ptyId: 'p1', processIncarnation: 'i1' } } : null,
      refusal: async (_paneKey, _handle, untouchedSince) => {
        fake.untouchedSince.push(untouchedSince)
        return fake.refusals.shift() ?? null
      },
      send: async (_bound, _agent, text, stillClear) => {
        if (!(await stillClear())) {
          return 'refused'
        }
        fake.sent.push({ to: 'h1', text, via: 'terminal' })
        return fake.outcome
      }
    }
  }
  return fake
}

const chat = { chatId: 'c1', kind: 'chat', agent: 'claude', idleSince: 5000 } as const
const terminal = { chatId: 'pane-1', kind: 'terminal', agent: 'claude', idleSince: 5000 } as const

describe('sendIdleRecoveryWake', () => {
  it('sends no wake while pause-all is engaged (BAD-685)', async () => {
    const fake = fakePorts()
    pause.engaged = true
    expect(await sendIdleRecoveryWake(chat, 'run the tests', fake.ports)).toBe(false)
    expect(fake.sent).toEqual([])
    pause.engaged = false
    expect(await sendIdleRecoveryWake(chat, 'run the tests', fake.ports)).toBe(true)
  })

  it('sends a short message that says it is from idle recovery and carries the next step', async () => {
    const fake = fakePorts()
    expect(await sendIdleRecoveryWake(chat, 'run the tests', fake.ports)).toBe(true)
    expect(fake.sent).toEqual([
      { to: 'c1', text: `${IDLE_RECOVERY_WAKE_MARKER}\nrun the tests`, via: 'chat' }
    ])
    expect(isWakePrompt(fake.sent[0].text)).toBe(true)
  })

  it('never wakes a sleeping chat, a chat in a turn or a chat that is gone', async () => {
    for (const facts of [
      { fence: 3, loaded: false, inTurn: false },
      { fence: 3, loaded: true, inTurn: true },
      null
    ]) {
      const fake = fakePorts()
      fake.chat = facts
      expect(await sendIdleRecoveryWake(chat, 'go on', fake.ports)).toBe(false)
      expect(fake.sent).toEqual([])
    }
  })

  it('checks again right before the send: a chat that got busy meanwhile is not woken', async () => {
    const fake = fakePorts()
    fake.chatAtSend = { fence: 3, loaded: true, inTurn: true }
    expect(await sendIdleRecoveryWake(chat, 'go on', fake.ports)).toBe(false)
    expect(fake.sent).toEqual([])
  })

  it('counts a queued or unknown send as taken, so it is never sent twice', async () => {
    for (const outcome of ['queued', 'unknown'] as const) {
      const fake = fakePorts()
      fake.outcome = outcome
      expect(await sendIdleRecoveryWake(chat, 'go on', fake.ports)).toBe(true)
    }
  })

  it('sends nothing without a next step', async () => {
    const fake = fakePorts()
    expect(await sendIdleRecoveryWake(chat, '  ', fake.ports)).toBe(false)
    expect(fake.sent).toEqual([])
  })

  it('types into a terminal that rests at an empty prompt', async () => {
    const fake = fakePorts()
    expect(await sendIdleRecoveryWake(terminal, 'go on', fake.ports)).toBe(true)
    expect(fake.sent).toMatchObject([{ via: 'terminal' }])
  })

  it('never types into a terminal with a draft, a dialog or a turn, or with no live terminal', async () => {
    for (const refusal of ['draft', 'prompt', 'in-turn', 'screen-unreadable', 'typed-since-idle']) {
      const fake = fakePorts()
      fake.refusals = [refusal]
      expect(await sendIdleRecoveryWake(terminal, 'go on', fake.ports)).toBe(false)
      expect(fake.sent).toEqual([])
    }
    const asleep = fakePorts()
    asleep.bound = false
    expect(await sendIdleRecoveryWake(terminal, 'go on', asleep.ports)).toBe(false)
  })

  it('checks the terminal again right before the write', async () => {
    const fake = fakePorts()
    fake.refusals = [null, 'draft']
    expect(await sendIdleRecoveryWake(terminal, 'go on', fake.ports)).toBe(false)
    expect(fake.sent).toEqual([])
  })

  it('asks whether the user typed since the turn ended, for a wake and not for an answer', async () => {
    const wake = fakePorts()
    await sendIdleRecoveryWake(terminal, 'go on', wake.ports)
    expect(wake.untouchedSince).toEqual([5000, 5000])
    const answer = fakePorts()
    await sendIdleRecoveryAnswer('pane-1', 'x', terminal, answer.ports)
    expect(answer.untouchedSince).toEqual([undefined, undefined])
  })
})

describe('sendIdleRecoveryAnswer', () => {
  it('sends the text unchanged to a chat', async () => {
    const fake = fakePorts()
    expect(await sendIdleRecoveryAnswer('c1', 'the second one', chat, fake.ports)).toBe('sent')
    expect(fake.sent).toEqual([{ to: 'c1', text: 'the second one', via: 'chat' }])
  })

  it('says not-found for a chat or terminal that is gone', async () => {
    const fake = fakePorts()
    fake.chat = null
    fake.bound = false
    expect(await sendIdleRecoveryAnswer('c1', 'x', chat, fake.ports)).toBe('not-found')
    expect(await sendIdleRecoveryAnswer('pane-1', 'x', terminal, fake.ports)).toBe('not-found')
    expect(await sendIdleRecoveryAnswer('who', 'x', undefined, fake.ports)).toBe('not-found')
  })

  it('answers a terminal only when nothing is typed there and no turn runs', async () => {
    const busy = fakePorts()
    busy.refusals = ['in-turn']
    expect(await sendIdleRecoveryAnswer('pane-1', 'x', terminal, busy.ports)).toBe('not-waiting')
    const draft = fakePorts()
    draft.refusals = ['draft']
    expect(await sendIdleRecoveryAnswer('pane-1', 'x', terminal, draft.ports)).toBe('unavailable')
    const clear = fakePorts()
    expect(await sendIdleRecoveryAnswer('pane-1', 'x', terminal, clear.ports)).toBe('sent')
    expect(busy.sent.concat(draft.sent)).toEqual([])
  })
})

describe('idleRecoveryTerminalPort', () => {
  function runtime(overrides: Record<string, unknown>): () => IdleRecoveryTerminalRuntime {
    const base = {
      getTerminalHandleForPaneKey: () => 'h1',
      getTerminalPromptRequestBinding: () => ({ ptyId: 'p1', processIncarnation: 'i4' }),
      isWorkerAgentInTurn: () => false,
      readTerminalMailHold: () => null,
      readTerminal: async () => ({ source: 'screen', draft: '' }),
      terminalRunFacts: { readLastDrivingInputAt: () => null },
      ...overrides
    }
    return () => base as unknown as IdleRecoveryTerminalRuntime
  }

  it('binds a live terminal and nothing else', () => {
    expect(idleRecoveryTerminalPort(runtime({})).bind('pane-1')).toEqual({
      handle: 'h1',
      binding: { ptyId: 'p1', processIncarnation: 'i4' }
    })
    expect(
      idleRecoveryTerminalPort(runtime({ getTerminalHandleForPaneKey: () => null })).bind('pane-1')
    ).toBeNull()
    const noPty = runtime({
      getTerminalPromptRequestBinding: () => {
        throw new Error('no live pty')
      }
    })
    expect(idleRecoveryTerminalPort(noPty).bind('pane-1')).toBeNull()
    expect(idleRecoveryTerminalPort(() => null).bind('pane-1')).toBeNull()
  })

  it('refuses a turn, a hold, typed text and a screen it cannot read', async () => {
    const refusal = (overrides: Record<string, unknown>) =>
      idleRecoveryTerminalPort(runtime(overrides)).refusal('pane-1', 'h1')
    expect(await refusal({})).toBeNull()
    expect(await refusal({ isWorkerAgentInTurn: () => true })).toBe('in-turn')
    expect(await refusal({ readTerminalMailHold: () => ({ kind: 'prompt' }) })).toBe('prompt')
    expect(
      await refusal({ readTerminal: async () => ({ source: 'screen', draft: 'half a th' }) })
    ).toBe('draft')
    expect(await refusal({ readTerminal: async () => ({ source: 'screen-unavailable' }) })).toBe(
      'screen-unreadable'
    )
    expect(
      await refusal({
        readTerminal: async () => {
          throw new Error('gone')
        }
      })
    ).toBe('unreadable')
  })

  it('refuses a wake once the user typed into the terminal after its turn ended', async () => {
    const typedAt = (at: number | null) =>
      idleRecoveryTerminalPort(runtime({ terminalRunFacts: { readLastDrivingInputAt: () => at } }))
    expect(await typedAt(6000).refusal('pane-1', 'h1', 5000)).toBe('typed-since-idle')
    // Typed before the turn ended (the prompt itself), never typed, or an answer: not refused.
    expect(await typedAt(4000).refusal('pane-1', 'h1', 5000)).toBeNull()
    expect(await typedAt(null).refusal('pane-1', 'h1', 5000)).toBeNull()
    expect(await typedAt(6000).refusal('pane-1', 'h1')).toBeNull()
  })

  it('does not write for an agent it cannot prove', async () => {
    const port = idleRecoveryTerminalPort(runtime({}))
    const bound = { handle: 'h1', binding: { ptyId: 'p1', processIncarnation: 'i4' } }
    expect(await port.send(bound, 'not-an-agent', 'x', async () => true)).toBe('refused')
  })
})
