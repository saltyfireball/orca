// BAD-819: own pull request deliveries through the connector's real run hook: createConnectorCloud's
// machine, handed each raw delivery by the poll client's dispatchDelivery, into a real store,
// AutomationService, run writer, bot dispatcher and orchestration database. Only the workspace read
// (a worktree's branch) stands in.
import { randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isOrcaSessionId } from '../../../shared/agent-session/identity/orca-session-address'
import { setAppEnvironment } from '../../../shared/app-lifecycle/app-environment'
import { EVENT_ONLY_SCHEDULE } from '../../../shared/automation-event-triggers'
import { removeTreeSync } from '../../../shared/file-write/windows-transient-lock-removal'
import { chainDepthOfRun } from '../../automations/automation-chain-runs'
import { AutomationService } from '../../automations/automation-service'
import { createBotAutomationDispatcher } from '../../automations/bot-automation-launch'
import {
  fakeResults,
  fakeSessions,
  seedBot,
  seedBotAutomation
} from '../../automations/bot-automation.test-fixture'
import type { ConnectorCloud, ConnectorCloudOptions } from '../../connector-cloud/connector-cloud'
import {
  createConnectorCloud,
  type ConnectorCloudHost
} from '../../connector-cloud/connector-cloud-install'
import { dispatchDelivery } from '../../connector-cloud/connector-deliveries'
import { fakeSeam } from '../../connector-cloud/fake-connector-seam.test-fixture'
import type { ExternalConversationHost } from '../../external-conversations/external-conversation-host'
import { closeTestStores, createStore, testState } from '../../persistence/persistence-test-harness'
import type { Store } from '../../persistence/loading-store/store'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { recordReadyFederatedDispatch } from '../../runtime/orchestration/legacy-remote-home/federated-worker-ready-record'
import {
  inboxSourceItems,
  pauseFromInboxSource,
  registerForkInboxSource
} from '../idle-recovery/idle-recovery-sources'
import { OWN_PR_CAP_REASON, OWN_PR_LOOP_REASON, OWN_PR_WINDOW_MS } from './own-pr-loop-guard'
import { ownPrLoopInbox } from './own-pr-loop-inbox'
import { runWorktrees } from './own-pr-loop-run'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf-8'),
    decryptString: (ciphertext: Buffer) => ciphertext.toString('utf-8').slice('encrypted:'.length)
  }
}))

const OWNER = '100'
const SOMEONE = '200'
const REPO = 'repo-1'
// A fixed clock that each delivery moves on a second, so runs keep their order.
const START = Date.UTC(2026, 10, 25, 12, 0, 0)
let clock = START
let orchestration: OrchestrationDb

/** A process restart: module state such as the Decision inbox's sources starts empty. */
function restartInboxSources() {
  registerForkInboxSource({
    id: 'pr-loop',
    items: async () => [],
    answer: async () => null,
    dismiss: async () => false
  })
}

/** A worker the chat started, in a worktree of this host or of a paired server. */
function startWorker(chatSessionId: string, worktreeId: string, placed: 'here' | 'paired') {
  if (!isOrcaSessionId(chatSessionId)) {
    throw new Error('not an Orca session id')
  }
  const task = orchestration.createTask({ runId: 'run_legacy_local', spec: 'Open a pull request' })
  const { dispatch } = orchestration.createStartingWorkerDispatch({
    creator: { kind: 'session', orcaSessionId: chatSessionId },
    maxDepth: 10,
    taskId: task.id,
    startOptions: { agent: 'claude' },
    ...(placed === 'paired'
      ? {
          federation: {
            environmentId: 'env-paired',
            environmentName: 'Paired server',
            peerFingerprint: 'peer-fingerprint',
            protocolVersion: 1
          }
        }
      : {})
  })
  if (placed === 'paired') {
    recordReadyFederatedDispatch(orchestration, dispatch.id, {
      dispatchId: dispatch.id,
      state: 'ready',
      runtimeEpoch: 'remote-epoch',
      worktreeId,
      terminalHandle: 'term_remote'
    })
  } else {
    orchestration.recordWorkerStage({ dispatchId: dispatch.id, stage: 'ready', worktreeId })
  }
}

describe('own pull requests through the connector run hook', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-own-pr-loop-test-'))
    clock = START
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(clock)
    vi.stubEnv('ORCA_CLOUD_API_URL', 'http://127.0.0.1:9')
    vi.stubEnv('ORCA_CLOUD_CLIENT_ID', 'own-pr-loop-test')
    setAppEnvironment({
      getPath: () => testState.dir,
      getAppPath: () => testState.dir,
      getVersion: () => '0.0.0-test',
      isPackaged: () => false,
      onWillQuit: () => {},
      exit: () => {},
      getAppMetrics: () => []
    })
    orchestration = new OrchestrationDb(':memory:')
    restartInboxSources()
  })
  afterEach(async () => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    orchestration.close()
    await closeTestStores()
    removeTreeSync(testState.dir)
  })

  async function setup(from?: string[]) {
    const store = await createStore()
    const bot = seedBot(store)
    const automation = seedBotAutomation(
      store,
      bot,
      {},
      {
        name: 'Review my pull requests',
        ...EVENT_ONLY_SCHEDULE,
        on: [
          {
            id: 'rule-1',
            source: 'github',
            event: 'pr_opened',
            in: ['acme/web'],
            fromOwner: true,
            ...(from ? { from } : {})
          }
        ]
      }
    )
    return { store, bot, automation, ...harness(store) }
  }

  // Each run gets its own chat; `opens` gives a run's chat a worker in a worktree on that branch.
  function harness(store: Store) {
    const sessions = fakeSessions()
    sessions.startConversation.mockImplementation(async () => ({
      sessionId: randomUUID(),
      clientMessageId: 'message',
      fingerprint: 'fingerprint'
    }))
    const { results } = fakeResults()
    const service = new AutomationService(store, {
      tickMs: 60_000,
      botDispatcher: createBotAutomationDispatcher(sessions, results)
    })
    const branches = new Map<string, string>()
    const opens = (chatSessionId: string, branch: string, placed: 'here' | 'paired' = 'here') => {
      const worktreeId = `${REPO}::/work/${branch}`
      startWorker(chatSessionId, worktreeId, placed)
      branches.set(`id:${worktreeId}`, branch)
    }
    const runtime = {
      runAutomationForEvent: (...args: Parameters<AutomationService['runForEvent']>) =>
        service.runForEvent(...args),
      getOrchestrationDb: () => orchestration,
      showManagedTerminalWorkspace: async (selector: string) => {
        const branch = branches.get(selector)
        if (!branch) {
          throw new Error('selector_not_found')
        }
        return { branch }
      }
    }
    const cloud = createConnectorCloud({
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a trigger delivery reaches only these runtime members; the rest of the host is read lazily for other kinds.
      runtime: runtime as unknown as ConnectorCloudHost['runtime'],
      store,
      userDataPath: testState.dir,
      // A headless host's connector, as `orca serve` makes it.
      kind: 'serve',
      isFenced: () => false,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: read only for a bot on GitHub's hello and a webhook's call, neither of which these deliveries are.
      gitHubInstallations: {} as ConnectorCloudHost['gitHubInstallations'],
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: as above.
      webhooks: {} as ConnectorCloudHost['webhooks']
    })
    const machine = machineOf(cloud)
    const seam = fakeSeam().seam
    let pr = 0
    const deliver = async (
      automationId: string,
      botId: string,
      headRef: string,
      actorId = OWNER,
      number = ++pr,
      extra: Record<string, unknown> = {}
    ) => {
      clock += 1_000
      vi.setSystemTime(clock)
      const raw = {
        kind: 'trigger',
        deliveryId: `del-${number}`,
        expiresAt: clock + 60_000,
        conversation: { source: 'github', externalId: `acme/web#${number}` },
        automationId,
        triggerId: 'rule-1',
        botId,
        ...extra,
        event: {
          key: `pr:${number}:opened`,
          occurredAt: clock,
          actorId,
          ...(actorId === OWNER ? { fromOwner: true } : {}),
          place: 'acme/web',
          pr: { repoId: '777', number, headRef, headSha: 'a'.repeat(40) },
          ...extra
        }
      }
      const dispatched = dispatchDelivery(
        seam,
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a trigger delivery never reaches the conversation host.
        {} as ExternalConversationHost,
        machine,
        raw,
        (expiresAt) => expiresAt - Date.now()
      )
      return (await dispatched?.done)?.outcome === 'accepted'
    }
    const newest = (automationId: string) =>
      store
        .listAutomationRuns(automationId)
        .reduce((latest, run) => (run.createdAt >= latest.createdAt ? run : latest))
    return { service, opens, deliver, newest }
  }

  function machineOf(cloud: ConnectorCloud | null) {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the options the connector was made with; the poll client reads its machine from them.
    const options = (cloud as unknown as { options: ConnectorCloudOptions } | null)?.options
    if (!options) {
      throw new Error('no connector cloud')
    }
    return options.machine
  }

  const loopRows = async () => (await inboxSourceItems()).filter((row) => row.source === 'pr-loop')

  it('stops a run that keeps opening pull requests at the chain limit, with one skipped run and one inbox row', async () => {
    const { store, bot, automation, opens, deliver, newest } = await setup()
    // The owner opens the first by hand; each run's worker then opens the next.
    expect(await deliver(automation.id, bot.id, 'feature/by-hand')).toBe(true)
    for (const branch of ['agent/one', 'agent/two', 'agent/three', 'agent/four']) {
      const opener = await vi.waitFor(() => {
        const run = newest(automation.id)
        expect(run.chatSessionId).toBeTruthy()
        return run
      })
      opens(opener.chatSessionId!, branch)
      expect(await deliver(automation.id, bot.id, branch)).toBe(true)
    }
    const runs = store
      .listAutomationRuns(automation.id)
      .toSorted((a, b) => a.createdAt - b.createdAt)
    expect(runs.map((run) => run.status.startsWith('skipped_'))).toEqual([
      false,
      false,
      false,
      false,
      true
    ])
    expect(runs.slice(0, 4).map((run) => run.event?.chain?.depth ?? 0)).toEqual([0, 1, 2, 3])
    expect(runs[4]?.error).toContain(OWN_PR_LOOP_REASON)
    expect(runs[4]?.error).toContain('the limit is 3')

    const rows = await loopRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ chatId: `pr-loop:${automation.id}`, source: 'pr-loop' })
    expect(rows[0]?.question).toContain(OWN_PR_LOOP_REASON)

    // Dismiss takes the row off for good, also for a new inbox read after a restart.
    const dismissed = await pauseFromInboxSource(
      { chatId: `pr-loop:${automation.id}`, paused: true, source: 'pr-loop' },
      0
    )
    expect(dismissed.saved).toBe(true)
    expect(await loopRows()).toEqual([])
    expect(await ownPrLoopInbox(store, testState.dir).items()).toEqual([])
  })

  it('skips own pull requests past the cap in the window, keeps the count and the inbox row over a restart, and starts the ones below it', async () => {
    const first = await setup()
    for (let index = 0; index < 4; index += 1) {
      expect(await first.deliver(first.automation.id, first.bot.id, `feature/${index}`)).toBe(true)
    }
    // A restart: the same profile's store, opened again, and a new connector.
    await closeTestStores()
    restartInboxSources()
    let store = await createStore()
    let again = harness(store)
    const id = first.automation.id
    expect(await again.deliver(id, first.bot.id, 'feature/4', OWNER, 5)).toBe(true)
    expect(await again.deliver(id, first.bot.id, 'feature/5', OWNER, 6)).toBe(true)
    const runs = store.listAutomationRuns(id).toSorted((a, b) => a.createdAt - b.createdAt)
    expect(runs).toHaveLength(6)
    expect(runs.slice(0, 5).every((run) => !run.status.startsWith('skipped_'))).toBe(true)
    expect(runs[5]).toMatchObject({ status: 'skipped_unavailable' })
    expect(runs[5]?.error).toContain(OWN_PR_CAP_REASON)

    // Restarted again: the row from before is listed as soon as the connector is made, with no
    // delivery since.
    await closeTestStores()
    restartInboxSources()
    store = await createStore()
    again = harness(store)
    expect(await loopRows()).toHaveLength(1)

    // The same pull request delivered again finds its skipped run and adds nothing.
    expect(await again.deliver(id, first.bot.id, 'feature/5', OWNER, 6)).toBe(true)
    expect(store.listAutomationRuns(id)).toHaveLength(6)

    // The row leaves once the window passes with no new stop.
    const later = clock + OWN_PR_WINDOW_MS + 1
    expect(await ownPrLoopInbox(store, testState.dir).items()).toHaveLength(1)
    expect(await ownPrLoopInbox(store, testState.dir, () => later).items()).toEqual([])
  })

  it("leaves someone else's pull requests as they were", async () => {
    const { store, bot, automation, deliver } = await setup([SOMEONE])
    for (let index = 0; index < 7; index += 1) {
      expect(await deliver(automation.id, bot.id, `their/${index}`, SOMEONE)).toBe(true)
    }
    const runs = store.listAutomationRuns(automation.id)
    expect(runs).toHaveLength(7)
    expect(runs.every((run) => !run.status.startsWith('skipped_'))).toBe(true)
    expect(await loopRows()).toEqual([])
  })

  it('reads a run worker on a paired server as cannot tell, never as a worktree here', async () => {
    const chat = randomUUID()
    startWorker(chat, `${REPO}::/work/agent/here`, 'here')
    startWorker(chat, `${REPO}::/work/agent/there`, 'paired')
    expect(runWorktrees(orchestration, { chatSessionId: chat, workspaceId: null })).toEqual({
      worktrees: new Set([`${REPO}::/work/agent/here`]),
      unknown: true
    })
    const local = randomUUID()
    startWorker(local, `${REPO}::/work/agent/local`, 'here')
    expect(runWorktrees(orchestration, { chatSessionId: local, workspaceId: null })).toEqual({
      worktrees: new Set([`${REPO}::/work/agent/local`]),
      unknown: false
    })

    // The paired worker's pull request: no run here can be told to have opened it, so it starts at
    // depth 0 and only the cap holds.
    const { store, bot, automation, opens, deliver, newest } = await setup()
    expect(await deliver(automation.id, bot.id, 'feature/by-hand')).toBe(true)
    const opener = await vi.waitFor(() => {
      const run = newest(automation.id)
      expect(run.chatSessionId).toBeTruthy()
      return run
    })
    opens(opener.chatSessionId!, 'agent/remote', 'paired')
    expect(await deliver(automation.id, bot.id, 'agent/remote')).toBe(true)
    const started = store.listAutomationRuns(automation.id).map((run) => chainDepthOfRun(run))
    expect(started).toEqual([0, 0])
  })

  it('never takes a chain from a delivery or any other event a run starts on', async () => {
    const { store, bot, automation, service, deliver } = await setup([SOMEONE])
    const forged = { automationId: automation.id, runId: 'run-forged', depth: 9 }
    // Through the connector: the contract drops what the cloud's shapes do not name.
    expect(
      await deliver(automation.id, bot.id, 'their/forged', SOMEONE, 1, { chain: forged })
    ).toBe(true)
    // Straight to the service, as a webhook, Google or in-turn start would hand it one.
    for (const [index, gate] of [undefined, { inTurn: null }].entries()) {
      await service.runForEvent(
        automation.id,
        {
          triggerId: 'rule-1',
          source: 'github',
          event: 'pr_opened',
          key: `pr:${10 + index}:opened`,
          occurredAt: Date.now(),
          actorId: SOMEONE,
          chain: forged
        },
        gate
      )
    }
    const runs = store.listAutomationRuns(automation.id)
    expect(runs).toHaveLength(3)
    expect(runs.map((run) => run.event?.chain)).toEqual([undefined, undefined, undefined])
    expect(runs.map((run) => chainDepthOfRun(run))).toEqual([0, 0, 0])
  })
})
