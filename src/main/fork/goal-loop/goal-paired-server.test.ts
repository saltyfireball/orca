// Goal loop (BAD-682) on a paired server: `orca goal set|list|clear --environment` from home,
// through the real CLI client, the E2EE WebSocket pairing and the server's real RPC handlers and
// goal loop. Only the agent itself is a stand-in on the server (its idle row, the send, the
// ledger read). The check runs for real, in the server's folder; nothing runs at home.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IdleRecoveryCandidate } from '../idle-recovery/idle-recovery-types'

const lab = vi.hoisted(() => ({
  data: '',
  work: '',
  agentId: '',
  kind: 'terminal' as 'terminal' | 'chat',
  idleSince: 1000,
  rounds: 0,
  sent: [] as string[],
  spendUsd: 0,
  onRound: (_round: number): void => {},
  runtimesAsked: [] as unknown[]
}))

vi.mock('../../orca-profiles/profile-storage-paths', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getProfileUserDataPath: () => lab.data
}))
vi.mock('../idle-recovery/idle-recovery-candidates', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listIdleRecoveryCandidatesWith: async (): Promise<IdleRecoveryCandidate[]> => [
    {
      chatId: lab.agentId,
      kind: lab.kind,
      agent: 'claude',
      cwd: lab.work,
      title: 'lab agent',
      workspace: 'lab',
      worktreeId: null,
      role: 'standalone',
      requestSource: 'user',
      lastPrompt: 'make done.txt',
      idleSince: lab.idleSince,
      backgroundPending: false,
      scheduledWake: false,
      coordinatorBusy: false
    } as IdleRecoveryCandidate
  ]
}))
vi.mock('../agent-guards/agent-guards-host', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readAgentGuardRows: async (runtime: unknown) => {
    lab.runtimesAsked.push(runtime)
    return lab.kind === 'chat'
      ? {
          chats: [
            {
              kind: 'chat',
              sessionId: lab.agentId,
              agent: 'claude',
              title: 'lab chat',
              worktreeId: null,
              working: false
            }
          ],
          live: new Set([lab.agentId]),
          terminals: new Map()
        }
      : { chats: [], live: new Set(), terminals: new Map([[lab.agentId, 'lab agent']]) }
  }
}))
vi.mock('../agent-guards/agent-guards-scopes', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  agentGuardSpendOf: () => ({ totalUsd: lab.spendUsd, isWorker: false })
}))
vi.mock('../idle-recovery/idle-recovery-ending', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readIdleRecoveryEndingWith: async () => ({ lastAssistantMessage: 'still working' })
}))
vi.mock('../idle-recovery/idle-recovery-notify', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  sendForkNotifyTargets: async () => {}
}))
// The agent's next turn: it reads the message, does one round of work and ends its turn again.
vi.mock('./goal-send', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  sendGoalText: async (_target: unknown, text: string) => {
    lab.sent.push(text)
    if (!text.startsWith("Orca's goal loop stopped")) {
      lab.rounds += 1
      lab.onRound(lab.rounds)
      lab.idleSince += 1000
    }
    return true
  }
}))

const { parsePairingCode } = await import('../../../shared/remote-runtime/pairing/pairing')
const { addEnvironmentFromPairingCode } =
  await import('../../../shared/remote-runtime/host-store/runtime-environment-store-operations')
const { OrcaRuntimeService } = await import('../../runtime/orca-runtime')
const { OrcaRuntimeRpcServer } = await import('../../runtime/rpc/server/runtime-rpc')
const { STATUS_METHODS } = await import('../../runtime/rpc/methods/host-management/status')
const { FORK_GOAL_LOOP_METHODS } = await import('../../runtime/rpc/methods/fork/fork-goal-loop')
const { RuntimeClient } = await import('../../../cli/runtime/client')
const { FORK_GOAL_LOOP_HANDLERS } = await import('../../../cli/fork/goal-loop-handlers')
const { goalLoopService } = await import('./goal-live')

let home: string
let homeWork: string
let serverRuntime: InstanceType<typeof OrcaRuntimeService>
let server: InstanceType<typeof OrcaRuntimeRpcServer>
let client: InstanceType<typeof RuntimeClient>

beforeAll(async () => {
  lab.data = mkdtempSync(join(tmpdir(), 'goal-lab-data-'))
  lab.work = mkdtempSync(join(tmpdir(), 'goal-lab-work-'))
  home = mkdtempSync(join(tmpdir(), 'goal-home-data-'))
  homeWork = mkdtempSync(join(tmpdir(), 'goal-home-work-'))
  serverRuntime = new OrcaRuntimeService()
  vi.spyOn(serverRuntime, 'requireStore').mockReturnValue({
    getSettings: () => ({ forkGoalLoopIdleSeconds: 0 })
  } as unknown as ReturnType<typeof serverRuntime.requireStore>)
  server = new OrcaRuntimeRpcServer({
    runtime: serverRuntime,
    userDataPath: lab.data,
    enableWebSocket: true,
    wsPort: 0,
    methods: [...STATUS_METHODS, ...FORK_GOAL_LOOP_METHODS]
  })
  await server.start()
  const offer = server.createPairingOffer({ address: '127.0.0.1', scope: 'runtime', name: 'Home' })
  if (!offer.available || !parsePairingCode(offer.pairingUrl)) {
    throw new Error('WebSocket pairing unavailable')
  }
  addEnvironmentFromPairingCode(home, { name: 'lab', pairingCode: offer.pairingUrl })
  client = new RuntimeClient(home, 30_000, null, 'lab')
}, 60_000)

afterAll(async () => {
  await server?.stop()
  for (const dir of [lab.data, lab.work, home, homeWork]) {
    rmSync(dir, { recursive: true, force: true })
  }
})

let agentCount = 0
beforeEach(() => {
  agentCount += 1
  lab.agentId = `tab-lab-${agentCount}:leaf-1`
  lab.kind = 'terminal'
  lab.idleSince = 1000
  lab.rounds = 0
  lab.sent = []
  lab.spendUsd = 0
  lab.runtimesAsked = []
  lab.onRound = (round) => writeFileSync(join(lab.work, `round-${agentCount}-${round}.txt`), 'x')
})

/** `orca goal <verb> --environment lab --json` from home; the parsed JSON it prints. */
async function orcaGoal(verb: string, flags: Record<string, string> = {}): Promise<unknown> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  try {
    await FORK_GOAL_LOOP_HANDLERS[`goal ${verb}`]({
      flags: new Map(Object.entries(flags)),
      client,
      cwd: homeWork,
      json: true
    })
    return JSON.parse(String(log.mock.calls.at(-1)?.[0])).result
  } finally {
    log.mockRestore()
  }
}

type Goal = { id: string; status: string; rounds: number; stop?: { reason: string } }
async function goalOf(id: string): Promise<Goal | undefined> {
  const listed = (await orcaGoal('list')) as { goals: Goal[] }
  return listed.goals.find((goal) => goal.id === id)
}

/** The server's loop looks at the agent's turn ends until the goal stops (or `limit` sweeps). */
async function runServerLoop(limit = 8): Promise<void> {
  for (let i = 0; i < limit; i += 1) {
    await goalLoopService().sweep()
    if ((await goalOf(lab.agentId))?.status !== 'active') {
      return
    }
  }
}

describe('goal loop on a paired server', () => {
  it('re-prompts the server agent until the check passes there', async () => {
    const check = `test -f done-${agentCount}.txt`
    const marker = `pwd >> checks-${agentCount}.log; ${check}`
    lab.onRound = (round) => {
      writeFileSync(join(lab.work, `round-${agentCount}-${round}.txt`), 'x')
      if (round === 2) {
        writeFileSync(join(lab.work, `done-${agentCount}.txt`), 'ok')
      }
    }
    const set = (await orcaGoal('set', { id: lab.agentId, 'until-cmd': marker })) as {
      goal: Goal
    }
    expect(set.goal).toMatchObject({ id: lab.agentId, status: 'active' })
    // The goal was matched against the server's own agents, by the server's runtime.
    expect(lab.runtimesAsked).toEqual([serverRuntime])

    await runServerLoop()
    expect(await goalOf(lab.agentId)).toMatchObject({
      status: 'stopped',
      rounds: 2,
      stop: { reason: 'met' }
    })
    expect(lab.sent).toHaveLength(2)
    // The check ran three times, each in the server's folder; nothing ran at home.
    const ran = readFileSync(join(lab.work, `checks-${agentCount}.log`), 'utf8')
      .trim()
      .split('\n')
    expect(ran).toHaveLength(3)
    expect(new Set(ran.map((line) => line.replace(/^\/private/u, '')))).toEqual(
      new Set([lab.work.replace(/^\/private/u, '')])
    )
    expect(existsSync(join(homeWork, `checks-${agentCount}.log`))).toBe(false)
  })

  it('re-prompts a native chat on the server until the check passes there', async () => {
    lab.kind = 'chat'
    lab.agentId = `sess-lab-${agentCount}`
    lab.onRound = (round) => writeFileSync(join(lab.work, `chat-${agentCount}-${round}.txt`), 'x')
    await orcaGoal('set', { id: lab.agentId, 'until-cmd': `test -f chat-${agentCount}-1.txt` })
    await runServerLoop()
    expect(await goalOf(lab.agentId)).toMatchObject({
      status: 'stopped',
      rounds: 1,
      stop: { reason: 'met' }
    })
    expect(lab.sent).toHaveLength(1)
  })

  it('stops at max rounds there, tells the agent and the server inbox', async () => {
    await orcaGoal('set', {
      id: lab.agentId,
      'until-cmd': 'test -f never.txt',
      'max-rounds': '2'
    })
    await runServerLoop()
    expect(await goalOf(lab.agentId)).toMatchObject({
      status: 'stopped',
      rounds: 2,
      stop: { reason: 'max-rounds' }
    })
    expect(lab.sent).toHaveLength(3)
    expect(lab.sent[2]).toMatch(/^Orca's goal loop stopped/)
    const inbox = await goalLoopService().inboxItems()
    expect(inbox.some((item) => item.chatId === `goal:${lab.agentId}`)).toBe(true)
  })

  it('stops on the budget there', async () => {
    await orcaGoal('set', { id: lab.agentId, 'until-cmd': 'test -f never.txt', budget: '1' })
    lab.onRound = (round) => {
      writeFileSync(join(lab.work, `round-${agentCount}-${round}.txt`), 'x')
      lab.spendUsd = 1.5
    }
    await runServerLoop()
    expect(await goalOf(lab.agentId)).toMatchObject({
      status: 'stopped',
      rounds: 1,
      stop: { reason: 'budget' }
    })
  })

  it('lists and clears a server goal from home', async () => {
    await orcaGoal('set', { id: lab.agentId, 'until-cmd': 'test -f never.txt' })
    expect(await goalOf(lab.agentId)).toMatchObject({ status: 'active', rounds: 0 })
    expect(await orcaGoal('clear', { id: lab.agentId })).toEqual({
      id: lab.agentId,
      cleared: true
    })
    expect(await goalOf(lab.agentId)).toBeUndefined()
    // The server keeps its goals in its own data folder, never in home's.
    expect(existsSync(join(lab.data, 'fork-goal-loop.json'))).toBe(true)
    expect(existsSync(join(home, 'fork-goal-loop.json'))).toBe(false)
  })
})
