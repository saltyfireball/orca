// BAD-819: own pull request deliveries through the connector's run hook (runTriggerDelivery with
// forkOwnPrLoopRun), a real store, AutomationService, run writer and bot dispatcher. Orchestration
// and the workspace read stand in for the workers a run started and the branches they have.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EVENT_ONLY_SCHEDULE } from '../../../shared/automation-event-triggers'
import { ConnectorDelivery } from '../../../shared/connectors/connector-cloud-contract'
import { removeTreeSync } from '../../../shared/file-write/windows-transient-lock-removal'
import { AutomationService } from '../../automations/automation-service'
import { createBotAutomationDispatcher } from '../../automations/bot-automation-launch'
import {
  fakeResults,
  fakeSessions,
  seedBot,
  seedBotAutomation
} from '../../automations/bot-automation.test-fixture'
import { runTriggerDelivery } from '../../connector-cloud/connector-triggers'
import { closeTestStores, createStore, testState } from '../../persistence/persistence-test-harness'
import type { Store } from '../../persistence/loading-store/store'
import { inboxSourceItems, pauseFromInboxSource } from '../idle-recovery/idle-recovery-sources'
import { OWN_PR_CAP_REASON, OWN_PR_LOOP_REASON, OWN_PR_WINDOW_MS } from './own-pr-loop-guard'
import { ownPrLoopInbox } from './own-pr-loop-inbox'
import { forkOwnPrLoopRun, type OwnPrLoopHost } from './own-pr-loop-run'

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
// A fixed clock that each delivery moves on a second, so runs keep their order.
const START = Date.UTC(2026, 10, 25, 12, 0, 0)
let clock = START

describe('own pull requests through the connector run hook', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-own-pr-loop-test-'))
    clock = START
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(clock)
  })
  afterEach(async () => {
    vi.useRealTimers()
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

  // Each run gets its own chat; `opens` gives a run's chat a worker on that branch.
  function harness(store: Store) {
    const sessions = fakeSessions()
    let chats = 0
    sessions.startConversation.mockImplementation(async () => ({
      sessionId: `chat-${++chats}`,
      clientMessageId: 'message',
      fingerprint: 'fingerprint'
    }))
    const { results } = fakeResults()
    const service = new AutomationService(store, {
      tickMs: 60_000,
      botDispatcher: createBotAutomationDispatcher(sessions, results)
    })
    const workers = new Map<string, string>()
    const branches = new Map<string, string>()
    const opens = (chatSessionId: string, branch: string) => {
      workers.set(chatSessionId, `wt-${branch}`)
      branches.set(`id:wt-${branch}`, branch)
    }
    const runtime: OwnPrLoopHost['runtime'] = {
      runAutomationForEvent: (id, event, gate) => service.runForEvent(id, event, gate),
      getOrchestrationDb: () => ({
        listDispatchIdsCreatedBySession: (session) =>
          workers.has(session) ? [`dispatch-${session}`] : [],
        listWorkerTerminalResources: ({ dispatchIds }) =>
          dispatchIds.map((id) => ({
            worktreeId: workers.get(id.slice('dispatch-'.length)) ?? null
          }))
      }),
      showManagedTerminalWorkspace: async (selector) => {
        const branch = branches.get(selector)
        if (!branch) {
          throw new Error('selector_not_found')
        }
        return { branch }
      }
    }
    let pr = 0
    const deliver = async (
      automationId: string,
      botId: string,
      headRef: string,
      actorId = OWNER,
      number = ++pr
    ) => {
      clock += 1_000
      vi.setSystemTime(clock)
      const delivery = ConnectorDelivery.parse({
        kind: 'trigger',
        deliveryId: `del-${number}`,
        expiresAt: clock + 60_000,
        conversation: { source: 'github', externalId: `acme/web#${number}` },
        automationId,
        triggerId: 'rule-1',
        botId,
        event: {
          key: `pr:${number}:opened`,
          occurredAt: clock,
          actorId,
          ...(actorId === OWNER ? { fromOwner: true } : {}),
          place: 'acme/web',
          // The cloud's own fields only: a delivery naming a chain is stripped by the contract.
          pr: { repoId: '777', number, headRef, headSha: 'a'.repeat(40) }
        }
      })
      if (delivery.kind !== 'trigger') {
        throw new Error('not a trigger delivery')
      }
      const host = { runtime, store, userDataPath: testState.dir }
      return await runTriggerDelivery(
        {
          automations: store.listAutomations(),
          bots: [{ id: botId }],
          webhook: () => false,
          run: forkOwnPrLoopRun(host, delivery)
        },
        delivery
      )
    }
    const newest = (automationId: string) =>
      store
        .listAutomationRuns(automationId)
        .reduce((latest, run) => (run.createdAt >= latest.createdAt ? run : latest))
    return { service, opens, deliver, newest }
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

  it('skips own pull requests past the cap in the window, keeps the count over a restart, and starts the ones below it', async () => {
    const first = await setup()
    for (let index = 0; index < 4; index += 1) {
      expect(await first.deliver(first.automation.id, first.bot.id, `feature/${index}`)).toBe(true)
    }
    // A restart: the same profile's store, opened again.
    await closeTestStores()
    const store = await createStore()
    const again = harness(store)
    const id = first.automation.id
    expect(await again.deliver(id, first.bot.id, 'feature/4', OWNER, 5)).toBe(true)
    expect(await again.deliver(id, first.bot.id, 'feature/5', OWNER, 6)).toBe(true)
    const runs = store.listAutomationRuns(id).toSorted((a, b) => a.createdAt - b.createdAt)
    expect(runs).toHaveLength(6)
    expect(runs.slice(0, 5).every((run) => !run.status.startsWith('skipped_'))).toBe(true)
    expect(runs[5]).toMatchObject({ status: 'skipped_unavailable' })
    expect(runs[5]?.error).toContain(OWN_PR_CAP_REASON)

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
})
