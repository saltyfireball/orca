// SLRM-2385: agents an agent guard paused show in the Decision inbox whatever idle recovery's mode,
// and the inbox's answer and Resume go to the guard. The guard service is a fake here.
import { describe, expect, it, vi } from 'vitest'
import type { ForkIdleRecoveryInboxItem } from '../../../shared/fork/idle-recovery-wire'
import type { AgentGuardEntry } from '../../../shared/fork/agent-guards'
import type {
  ForkIdleRecoveryAnswerOutcome,
  ForkIdleRecoveryInboxItem
} from '../../../shared/fork/idle-recovery-wire'

const guard = vi.hoisted(() => ({
  items: new Array<ForkIdleRecoveryInboxItem>(),
  paused: new Set<string>(),
  answer: vi.fn(async () => 'sent' as const),
  resume: vi.fn(async (id: string) => ({ id, outcome: 'resumed' as const })),
  send: vi.fn(async (): Promise<ForkIdleRecoveryAnswerOutcome> => 'sent'),
  resume: vi.fn(async (id: string) => guard.paused.delete(id)),
  listeners: new Array<() => void>()
}))

vi.mock('../agent-guards/agent-guards-inbox', () => ({
  forkAgentGuardInboxItems: () => guard.items,
  forkAgentGuardPaused: (id: string) => guard.paused.has(id),
  forkAgentGuardAnswer: guard.answer,
  forkAgentGuardInboxResume: guard.resume,
  withForkAgentGuardRows: (
    guarded: ForkIdleRecoveryInboxItem[],
    items: ForkIdleRecoveryInboxItem[]
  ) => [...guarded, ...items],
  onForkAgentGuardPausesChanged: (listener: () => void) => {
    guard.listeners.push(listener)
    return () => {}
  }
}))

const { createIdleRecoveryService } = await import('./idle-recovery-service')
const { emptyIdleRecoveryState } = await import('./idle-recovery-state')

const item: ForkIdleRecoveryInboxItem = {
  chatId: 's1',
  kind: 'chat',
  agent: 'claude',
  title: 'Worker',
  workspace: '',
  worktreeId: null,
  verdict: 'guard',
  question: '',
  reason: 'Paused: the same tool call kept failing after a warning (7 times).',
  since: 1,
  wakes: 0,
  wakeAt: null,
  paused: false
}

function service() {
  const sendAnswer = vi.fn(async () => 'sent' as const)
  const created = createIdleRecoveryService({
    now: () => 5,
    loadState: async () => emptyIdleRecoveryState(),
    saveState: async () => {},
    sendAnswer,
    useRuntime: () => {},
    startTimer: () => () => {}
  })
  const changes = vi.fn()
  created.onChanged(changes)
  created.start(() => ({}), {})
  return { created, sendAnswer, changes }
}

describe('Decision inbox rows of agent guards', () => {
  it('lists them with idle recovery off, answers through the guard and resumes it', async () => {
    guard.items = [item]
    guard.paused = new Set(['s1'])
    const { created, sendAnswer, changes } = service()
    expect(await created.listInbox()).toEqual({ now: 5, mode: 'off', items: [item] })
    expect(await created.answer({ chatId: 's1', text: 'try the other script' })).toEqual({
      chatId: 's1',
      result: 'sent'
    })
    expect(guard.answer).toHaveBeenCalledWith('s1', 'try the other script')
    expect(sendAnswer).not.toHaveBeenCalled()
    const resumed = await created.setPaused({ chatId: 's1', paused: false })
    expect(resumed).toMatchObject({ chatId: 's1', paused: false, saved: true })
    expect(guard.resume).toHaveBeenCalledWith('s1')
    // A pause starting or ending tells the inbox's readers (the emit after an answer comes from it).
    guard.listeners.forEach((listener) => listener())
    expect(changes).toHaveBeenCalled()
  })

  it('a refused answer keeps the agent paused and returns why, so it is never lost', async () => {
    guard.entries = [entry]
    guard.paused = new Set(['s1'])
    guard.resume.mockClear()
    guard.send.mockResolvedValueOnce('not-waiting')
    const { created } = service()
    expect(await created.answer({ chatId: 's1', text: 'try again later' })).toEqual({
      chatId: 's1',
      result: 'not-waiting'
    })
    expect(guard.resume).not.toHaveBeenCalled()
    expect(guard.paused.has('s1')).toBe(true)
  })

  it('answers no other chat while idle recovery is off', async () => {
    guard.items = []
    guard.paused = new Set()
    const { created } = service()
    expect(await created.answer({ chatId: 'other', text: 'x' })).toEqual({
      chatId: 'other',
      result: 'unavailable'
    })
  })
})
