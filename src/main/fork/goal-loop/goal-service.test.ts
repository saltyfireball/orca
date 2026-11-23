// Goal loop (BAD-682): the service against a fake agent. The check runs for real, in a temp folder.
import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  readGoalLoopSettings,
  type GoalLoopSettings,
  type GoalRecord
} from '../../../shared/fork/goal-loop'
import { localCheckRunner, runDoneCheck } from '../completion-contract/check-runner'
import type { IdleRecoveryCandidate } from '../idle-recovery/idle-recovery-types'
import { createGoalService, type GoalServiceDeps } from './goal-service'

const pause = vi.hoisted(() => ({ engaged: false }))
vi.mock('../pause-all/pause-all-state', () => ({
  isForkPauseAllEngaged: () => pause.engaged,
  forkPauseAllRefusal: () => (pause.engaged ? 'Paused by pause-all: test' : null),
  onForkPauseAllChanged: () => () => {}
}))
afterEach(() => {
  pause.engaged = false
})

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'goal-loop-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** An agent that is idle after each turn and does what `work` says when it is sent a message. */
function fakeAgent(options: {
  work: (round: number) => Promise<void> | void
  settings?: Partial<GoalLoopSettings>
  spend?: () => number | null
  judge?: GoalServiceDeps['judge']
}) {
  let idleSince = 1000
  let round = 0
  const sent: string[] = []
  const saved: Map<string, GoalRecord>[] = []
  const settings: GoalLoopSettings = {
    ...readGoalLoopSettings({}),
    ...options.settings
  }
  const candidates = vi.fn(async (): Promise<IdleRecoveryCandidate[]> => [
    {
      chatId: 'agent-1234',
      kind: 'terminal',
      agent: 'claude',
      cwd: dir,
      title: 'fake',
      workspace: 'w',
      worktreeId: null,
      role: 'standalone',
      requestSource: 'user',
      lastPrompt: 'do it',
      idleSince,
      backgroundPending: false,
      scheduledWake: false,
      coordinatorBusy: false
    } as IdleRecoveryCandidate
  ])
  const deps: GoalServiceDeps = {
    now: () => 5_000_000,
    settings: () => settings,
    loadGoals: async () => new Map(),
    saveGoals: async (goals) => {
      saved.push(new Map(goals))
    },
    candidates,
    liveAgents: async () => [
      {
        id: 'agent-1234',
        kind: 'terminal',
        agent: 'claude',
        title: 'fake',
        worktreeId: null
      }
    ],
    fingerprint: async () => readFile(join(dir, 'p.txt'), 'utf8').catch(() => ''),
    agentOutput: async () => 'I think I am done',
    spentTotalUsd: options.spend ?? (() => 0),
    send: vi.fn(async (_target, text) => {
      sent.push(text)
      round += 1
      await options.work(round)
      // The agent's turn ends again: a new idle time.
      idleSince += 1000
      return true
    }),
    runCheck: async (cwd, command, current) => {
      const result = await runDoneCheck(localCheckRunner, { cwd, connectionId: null }, command, {
        timeoutMs: current.timeoutMs,
        outputLines: current.outputLines
      })
      return { ok: result.ok, output: result.output }
    },
    judge: options.judge ?? (async () => ({ met: false, reason: 'no judge' })),
    notifyStopped: vi.fn(),
    changed: vi.fn()
  }
  return { service: createGoalService(deps), deps, sent, candidates, saved }
}

async function sweepUntilStopped(service: ReturnType<typeof createGoalService>, max = 20) {
  for (let index = 0; index < max; index += 1) {
    await service.sweep()
    const { goals } = await service.list()
    if (goals[0]?.status === 'stopped') {
      return goals[0]
    }
  }
  throw new Error('goal never stopped')
}

describe('goal loop with a fake terminal agent', () => {
  it('takes no step while pause-all is engaged, and goes on after it lifts (BAD-685)', async () => {
    const agent = fakeAgent({ work: () => undefined })
    await agent.service.set({ id: 'agent-1', untilCmd: 'echo broken; exit 1' })
    pause.engaged = true
    for (let index = 0; index < 3; index += 1) {
      await agent.service.sweep()
    }
    expect(agent.sent).toEqual([])
    expect(agent.candidates).not.toHaveBeenCalled()
    pause.engaged = false
    await sweepUntilStopped(agent.service)
    expect(agent.sent.length).toBeGreaterThan(0)
  })

  it('re-prompts after each turn until the file exists, then stops met', async () => {
    const agent = fakeAgent({
      work: async (round) => {
        await writeFile(join(dir, 'p.txt'), String(round))
        if (round === 3) {
          await writeFile(join(dir, 'done.txt'), 'x')
        }
      }
    })
    await agent.service.set({ id: 'agent-1', untilCmd: 'test -f done.txt' })
    const goal = await sweepUntilStopped(agent.service)
    expect(goal.stop?.reason).toBe('met')
    expect(agent.sent).toHaveLength(3)
    expect(agent.sent[0]).toContain('did not pass')
    await access(join(dir, 'done.txt'))
    // Met needs no note and no inbox row.
    expect(await agent.service.inboxItems()).toEqual([])
  })

  it('stops after two identical failures and lists why in the inbox', async () => {
    const agent = fakeAgent({ work: () => undefined })
    await agent.service.set({
      id: 'agent-1',
      untilCmd: 'echo broken at line 4; exit 1'
    })
    const goal = await sweepUntilStopped(agent.service)
    expect(goal.stop?.reason).toBe('no-progress')
    // One continue message, then the repeat stops it; then the stop note.
    expect(agent.sent).toHaveLength(2)
    expect(agent.sent[1]).toContain('goal loop stopped')
    const items = await agent.service.inboxItems()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      source: 'goal',
      chatId: 'goal:agent-1234'
    })
  })

  it('stops at the round limit when the agent keeps changing things', async () => {
    const agent = fakeAgent({
      work: async (round) => {
        await writeFile(join(dir, 'p.txt'), String(round))
      }
    })
    await agent.service.set({
      id: 'agent-1',
      untilCmd: 'echo still failing; exit 1',
      maxRounds: 3
    })
    const goal = await sweepUntilStopped(agent.service)
    expect(goal.stop?.reason).toBe('max-rounds')
    expect(goal.rounds).toBe(3)
  })

  it('stops at the budget, counted from when the goal was set', async () => {
    let spent = 2
    const agent = fakeAgent({
      work: async (round) => {
        spent += 3
        await writeFile(join(dir, 'p.txt'), String(round))
      },
      spend: () => spent
    })
    await agent.service.set({ id: 'agent-1', untilCmd: 'false', budgetUsd: 5 })
    const goal = await sweepUntilStopped(agent.service)
    expect(goal.stop?.reason).toBe('budget')
    expect(goal.rounds).toBe(2)
  })

  it('says a budget is watched only while an active goal has one (BAD-766)', async () => {
    const agent = fakeAgent({ work: () => undefined })
    expect(agent.service.watchesSpend()).toBe(false)
    await agent.service.warm()
    await agent.service.set({ id: 'agent-1', untilCmd: 'false' })
    expect(agent.service.watchesSpend()).toBe(false)
    await agent.service.set({ id: 'agent-1', untilCmd: 'false', budgetUsd: 5 })
    expect(agent.service.watchesSpend()).toBe(true)
    await agent.service.clear('agent-1234')
    expect(agent.service.watchesSpend()).toBe(false)
  })

  it('stops on the budget before asking the judge', async () => {
    const judge = vi.fn(async () => ({ met: false, reason: 'x' }))
    const agent = fakeAgent({
      work: () => undefined,
      spend: () => 100,
      settings: { judgeCommand: 'judge' },
      judge
    })
    // Baseline is read at set time (100), so spend two later by making the spend move.
    await agent.service.set({
      id: 'agent-1',
      untilJudge: 'all docs',
      budgetUsd: 1
    })
    agent.deps.spentTotalUsd = () => 105
    const goal = await sweepUntilStopped(agent.service)
    expect(goal.stop?.reason).toBe('budget')
    expect(judge).not.toHaveBeenCalled()
  })

  it('gives the judge the agent output and ends on its verdict', async () => {
    const judge = vi.fn(async (_command: string, _criteria: string, output: string) => ({
      met: output.includes('done'),
      reason: 'ok'
    }))
    const agent = fakeAgent({
      work: () => undefined,
      settings: { judgeCommand: 'judge' },
      judge
    })
    await agent.service.set({ id: 'agent-1', untilJudge: 'it is done' })
    const goal = await sweepUntilStopped(agent.service)
    expect(goal.stop?.reason).toBe('met')
    expect(judge).toHaveBeenCalledWith(
      'judge',
      'it is done',
      'I think I am done',
      expect.anything()
    )
  })

  it('refuses --until-judge without a judge command, and both flags together', async () => {
    const agent = fakeAgent({ work: () => undefined })
    await expect(agent.service.set({ id: 'agent-1', untilJudge: 'x' })).rejects.toThrow(/No judge/)
    await expect(
      agent.service.set({ id: 'agent-1', untilJudge: 'x', untilCmd: 'true' })
    ).rejects.toThrow(/exactly one/)
    await expect(agent.service.set({ id: 'nope', untilCmd: 'true' })).rejects.toThrow(
      /No running agent/
    )
  })

  it('does nothing when no goal is set', async () => {
    const agent = fakeAgent({ work: () => undefined })
    expect(await agent.service.sweep()).toBe(false)
    expect(agent.candidates).not.toHaveBeenCalled()
    expect(agent.deps.send).not.toHaveBeenCalled()
  })

  it('does nothing while the setting is off', async () => {
    const agent = fakeAgent({
      work: () => undefined,
      settings: { enabled: false }
    })
    await agent.service.set({ id: 'agent-1', untilCmd: 'false' })
    expect(await agent.service.sweep()).toBe(false)
    expect(agent.deps.send).not.toHaveBeenCalled()
  })

  it('clears a goal', async () => {
    const agent = fakeAgent({ work: () => undefined })
    await agent.service.set({ id: 'agent-1', untilCmd: 'false' })
    expect(await agent.service.clear('agent-1234')).toEqual({
      id: 'agent-1234',
      cleared: true
    })
    expect((await agent.service.list()).goals).toEqual([])
  })
})
