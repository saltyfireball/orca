// BAD-822: how a goal ends when its agent leaves the live list. The terminal ends through the real
// runtime exit path, the goal through the real sweep and store; only the live list is a fake.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readGoalLoopSettings } from '../../../shared/fork/goal-loop'
import { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { setForkGoalCloseListener } from './goal-close-notes'
import { createGoalService, type GoalServiceDeps } from './goal-service'
import { readGoals, writeGoals } from './goal-store'
import { goalWorkerFinished } from './goal-worker-finished'

const LEAF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PANE = `tab_g:${LEAF}`

let dir = ''
let db: OrchestrationDb
let runtime: OrcaRuntimeService

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'goal-lost-'))
  db = new OrchestrationDb(':memory:')
  db.db.exec('PRAGMA foreign_keys = OFF')
  runtime = new OrcaRuntimeService(null)
  runtime.setOrchestrationDb(db)
  runtime.registerPty('pty-g', 'wt', null, {
    tabId: 'tab_g',
    leafId: LEAF,
    terminalHandle: 'term_g'
  })
})
afterEach(async () => {
  db.close()
  await rm(dir, { recursive: true, force: true })
})

function host(options: { restored?: () => boolean } = {}) {
  const path = join(dir, 'fork-goal-loop.json')
  const live = new Set([PANE])
  const notifyStopped = vi.fn<GoalServiceDeps['notifyStopped']>()
  const service = createGoalService({
    now: () => 9_000_000,
    settings: () => readGoalLoopSettings({}),
    loadGoals: () => readGoals(path),
    saveGoals: (goals) => writeGoals(path, goals),
    // The agent is never seen resting, so only the missing check can end its goal.
    candidates: async () => [],
    liveAgents: async () =>
      [...live].map((id) => ({
        id,
        kind: 'terminal' as const,
        agent: 'claude',
        title: 'Fix the parser',
        worktreeId: null
      })),
    restored: options.restored ?? (() => true),
    workerFinished: (id) => goalWorkerFinished(db, id),
    fingerprint: async () => '',
    agentOutput: async () => null,
    spentTotalUsd: () => 0,
    send: vi.fn(async () => true),
    runCheck: async () => ({ ok: false, output: 'still red' }),
    judge: async () => ({ met: false, reason: '' }),
    notifyStopped,
    changed: () => {}
  })
  // As startForkGoalLoop wires it.
  setForkGoalCloseListener((ids) => void service.noteClosed(ids))
  return { path, live, notifyStopped, service }
}

async function sweeps(service: ReturnType<typeof createGoalService>, count: number) {
  for (let index = 0; index < count; index += 1) {
    await service.sweep()
  }
  return (await service.list()).goals[0]
}

/** The pane's terminal ends; its agent row leaves the live list with it. */
async function endTerminal(
  h: ReturnType<typeof host>,
  how: 'closed' | 'exited' | 'killed'
): Promise<void> {
  if (how === 'closed') {
    // What a close through Orca (the window, the phone, `orca terminal close`) records first.
    runtime.markPtyStopRequested('pty-g')
  }
  await runtime.onPtyExit(
    'pty-g',
    how === 'exited' ? 1 : 0,
    undefined,
    how === 'killed' ? { cause: { kind: 'signaled', signal: 9 } } : {}
  )
  h.live.delete(PANE)
}

describe('a goal whose agent leaves (BAD-822)', () => {
  it('ends quietly when a person closed the terminal, and the cause survives a restart', async () => {
    const h = host()
    await h.service.set({ id: PANE, untilCmd: 'pnpm test' })
    await endTerminal(h, 'closed')
    await vi.waitFor(async () =>
      expect((await readGoals(h.path)).get(PANE)?.closedAt).toBe(9_000_000)
    )
    // A new start reads the note from disk.
    const next = host()
    next.live.delete(PANE)
    const goal = await sweeps(next.service, 12)
    expect(goal.stop?.reason).toBe('gone')
    expect(await next.service.inboxItems()).toEqual([])
    expect(next.notifyStopped).not.toHaveBeenCalled()
  })

  it.each(['exited', 'killed'] as const)(
    'raises one row and the notify targets when the agent %s on its own',
    async (how) => {
      const h = host()
      await h.service.set({ id: PANE, untilCmd: 'pnpm test' })
      await endTerminal(h, how)
      const goal = await sweeps(h.service, 12)
      expect(goal.stop?.reason).toBe('agent-lost')
      const items = await h.service.inboxItems()
      expect(items).toHaveLength(1)
      expect(items[0].reason).toContain('`pnpm test`')
      expect(items[0].reason).toContain('Rounds used: 0')
      await sweeps(h.service, 12)
      expect(h.notifyStopped).toHaveBeenCalledTimes(1)
      expect(h.notifyStopped.mock.calls[0][0].stop?.reason).toBe('agent-lost')
    }
  )

  it('drops a close note once the agent is seen running again', async () => {
    const h = host()
    await h.service.set({ id: PANE, untilCmd: 'pnpm test' })
    await h.service.noteClosed([PANE])
    // Reopened before the window ran out; a later crash is not a person's close.
    await sweeps(h.service, 4)
    h.live.delete(PANE)
    expect((await sweeps(h.service, 12)).stop?.reason).toBe('agent-lost')
  })

  it('ends quietly, saying so, for a worker that reported done', async () => {
    db.db
      .prepare(
        `INSERT INTO worker_terminal_resources
           (id, origin_dispatch_id, owner_dispatch_id, terminal_handle, pane_key)
         VALUES ('r-1', 'd-1', 'd-1', 'term_g', ?)`
      )
      .run(PANE)
    db.db
      .prepare(
        `INSERT INTO messages (id, from_handle, to_handle, subject, type, payload, read)
         VALUES ('m-1', 'dispatch:d-1', 'coordinator', 'done', 'worker_done', '{}', 1)`
      )
      .run()
    const h = host()
    await h.service.set({ id: PANE, untilCmd: 'pnpm test' })
    await endTerminal(h, 'exited')
    const goal = await sweeps(h.service, 12)
    expect(goal.stop).toMatchObject({
      reason: 'gone',
      text: expect.stringContaining('reported done')
    })
    expect(h.notifyStopped).not.toHaveBeenCalled()
  })

  it('after a restart, starts the missing window only once the restore has finished', async () => {
    // A goal file as the previous version wrote it, its agent missing twice before the restart.
    const path = join(dir, 'fork-goal-loop.json')
    const old = {
      id: PANE,
      kind: 'terminal',
      agent: 'claude',
      title: 'Fix the parser',
      worktreeId: null,
      until: { kind: 'cmd', command: 'pnpm test' },
      maxRounds: 0,
      budgetUsd: 0,
      baselineUsd: 0,
      createdAt: 1,
      status: 'active',
      rounds: 2,
      lastSignature: null,
      repeats: 0,
      handledIdleSince: null,
      sendFailures: 0,
      missing: 2,
      lastFailure: ''
    }
    await writeFile(path, JSON.stringify({ version: 1, goals: [old] }))
    let restored = false
    const h = host({ restored: () => restored })
    h.live.delete(PANE)
    expect((await sweeps(h.service, 40)).status).toBe('active')
    expect(h.notifyStopped).not.toHaveBeenCalled()
    restored = true
    // The full three looks from here, not what was left before the restart.
    expect((await sweeps(h.service, 8)).status).toBe('active')
    const goal = await sweeps(h.service, 4)
    expect(goal.stop?.reason).toBe('agent-lost')
    expect((await h.service.inboxItems())[0].reason).toContain('Rounds used: 2')
  })
})
