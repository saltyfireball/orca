// BAD-766: a goal --budget stops a Claude or Codex terminal with no spend cap and the loop guard
// off. The path under test is the real one: a hook post of the terminal agent goes through
// forkAgentGuardsObserveHook, which reads the transcript the post names into the usage ledger,
// and the goal loop reads that spend. Only the agent itself (its idle state, its workspace) is
// faked.
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readGoalLoopSettings } from '../../../shared/fork/goal-loop'
import type { IdleRecoveryCandidate } from '../idle-recovery/idle-recovery-types'

const state = vi.hoisted(() => ({ dataDir: '' }))
vi.mock('../../orca-profiles/profile-storage-paths', () => ({
  getProfileUserDataPath: () => state.dataDir
}))

const PANE = 'tab-1:pane-1'
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orca-goal-budget-'))
  state.dataDir = dir
  vi.resetModules()
  vi.stubEnv('VITEST', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(dir, { recursive: true, force: true })
})

const claudeRow = () =>
  JSON.stringify({
    type: 'assistant',
    timestamp: new Date(Date.now() + 1000).toISOString(),
    message: {
      id: 'msg-1',
      model: 'claude-sonnet-4-5',
      usage: { input_tokens: 1_000_000, output_tokens: 1000 }
    }
  })

const codexRows = () =>
  [
    JSON.stringify({
      type: 'turn_context',
      timestamp: new Date(Date.now() + 1000).toISOString(),
      payload: { model: 'gpt-5' }
    }),
    JSON.stringify({
      type: 'event_msg',
      timestamp: new Date(Date.now() + 1000).toISOString(),
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 1_000_000,
            cached_input_tokens: 0,
            output_tokens: 1000
          }
        }
      }
    })
  ].join('\n')

async function boot() {
  const ledger = await import('../usage-ledger/usage-ledger-service')
  ledger.installForkUsageLedgerService({
    filePath: join(dir, 'ledger.json'),
    readSettings: () => undefined,
    chatMeta: () => undefined
  })
  const guards = await import('./agent-guards-service')
  const scopes = await import('./agent-guards-scopes')
  const watch = await import('../goal-loop/goal-budget-watch')
  const { createGoalService } = await import('../goal-loop/goal-service')
  const runtime = {
    // Loop guard off, no cap of any kind set.
    requireStore: () => ({ getSettings: () => ({ forkAgentGuardLoop: false }) }),
    getWorktreePs: async () => ({ worktrees: [] }),
    getTerminalHandleForPaneKey: () => null
  }
  guards.startForkAgentGuards(runtime as never)
  let saved = new Map()
  const goals = createGoalService({
    now: () => 5_000_000,
    settings: () => readGoalLoopSettings({}),
    loadGoals: async () => new Map(),
    saveGoals: async (next) => {
      saved = new Map(next)
    },
    candidates: async () => [
      {
        chatId: PANE,
        kind: 'terminal',
        agent: 'claude',
        cwd: dir,
        title: 'agent',
        workspace: 'w',
        worktreeId: null,
        role: 'standalone',
        requestSource: 'user',
        lastPrompt: 'go',
        idleSince: 1000,
        backgroundPending: false,
        scheduledWake: false,
        coordinatorBusy: false
      } as IdleRecoveryCandidate
    ],
    liveAgents: async () => [
      { id: PANE, kind: 'terminal', agent: 'claude', title: 'agent', worktreeId: null }
    ],
    restored: () => true,
    workerFinished: () => false,
    fingerprint: async () => 'same',
    agentOutput: async () => '',
    spentTotalUsd: (id) => scopes.agentGuardSpendOf(id).totalUsd,
    send: async () => true,
    runCheck: async () => ({ ok: false, output: 'not yet' }),
    judge: async () => ({ met: false, reason: 'no' }),
    notifyStopped: () => undefined,
    changed: () => undefined
  })
  watch.setForkGoalBudgetWatch(() => goals.watchesSpend())
  return { guards, scopes, goals, saved: () => saved }
}

/** A hook post of a terminal agent that finished a tool call and names its transcript. */
function post(
  guards: Awaited<ReturnType<typeof boot>>['guards'],
  source: 'claude' | 'codex',
  transcript: string
): void {
  const body = {
    payload: {
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      tool_response: { ok: true },
      transcript_path: transcript
    }
  }
  guards.forkAgentGuardsObserveHook(source, body, {
    paneKey: PANE,
    worktreeId: 'wt',
    hookEventName: 'PostToolUse'
  })
}

describe.each([
  ['claude', claudeRow, 'transcript.jsonl'],
  ['codex', codexRows, 'rollout.jsonl']
] as const)('goal budget over a %s terminal with no cap set', (source, rows, file) => {
  it('stops the goal on its budget after the terminal spends past it', async () => {
    const { guards, goals } = await boot()
    const transcript = join(dir, file)
    writeFileSync(transcript, '')
    await goals.warm()
    await goals.set({ id: PANE, untilCmd: 'false', budgetUsd: 0.01 })
    appendFileSync(transcript, `${rows()}\n`)
    // The engine starts asynchronously: posts before it is up are dropped, as they would be live.
    await vi.waitFor(
      async () => {
        post(guards, source, transcript)
        await new Promise((resolve) => setTimeout(resolve, 30))
        expect((await goals.list()).goals[0]?.spentUsd).toBeGreaterThan(0.01)
      },
      { timeout: 3000 }
    )
    for (let index = 0; index < 20; index += 1) {
      await goals.sweep()
    }
    const [goal] = (await goals.list()).goals
    expect(goal.status).toBe('stopped')
    expect(goal.stop?.reason).toBe('budget')
  })

  it('reads no transcript when no goal has a budget', async () => {
    const { guards, scopes, goals } = await boot()
    const transcript = join(dir, file)
    writeFileSync(transcript, `${rows()}\n`)
    await goals.set({ id: PANE, untilCmd: 'false' })
    for (let index = 0; index < 10; index += 1) {
      post(guards, source, transcript)
      await new Promise((resolve) => setTimeout(resolve, 30))
    }
    expect(scopes.agentGuardSpendOf(PANE).totalUsd).toBeNull()
    // The same posts read it once a goal has a budget: the service was up, it only had no reason.
    await goals.set({ id: PANE, untilCmd: 'false', budgetUsd: 5 })
    await vi.waitFor(
      async () => {
        post(guards, source, transcript)
        await new Promise((resolve) => setTimeout(resolve, 30))
        expect(scopes.agentGuardSpendOf(PANE).totalUsd).toBeGreaterThan(0)
      },
      { timeout: 3000 }
    )
  })
})
