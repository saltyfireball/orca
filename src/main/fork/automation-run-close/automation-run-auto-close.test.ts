// BAD-848: a finished automation run's chat closes by itself. Runs go through a real store's
// automation run history, chats through a real structured chat host and record store, and closing
// through the real close (closeStructuredAgentSessionChild); `orca agent close` shares that close.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Automation } from '../../../shared/automations/automation-definition'
import { closeTestStores, createStore, testState } from '../../persistence/persistence-test-harness'
import type { Store } from '../../persistence/loading-store/store'
import { setStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import {
  createQueuedMessageTestRig,
  type QueuedMessageTestRig
} from '../../native-chat/agent-session-wire/host/testing/structured-agent-session-queued-message-rig.test-fixture'
import { HOST_TEST_NOW } from '../../native-chat/agent-session-wire/host/testing/structured-agent-session-host-test-data.test-fixture'
import {
  isAutoClosedChat,
  resetAutoClosedRegistryForTest
} from '../bot-chat-close/bot-chat-auto-closed-registry'
import { forkReopenAutoClosedChat } from '../bot-chat-close/bot-chat-reopen'
import { automationRunAutoCloseDeps } from './automation-run-auto-close-service'
import { runAutomationRunAutoClosePass } from './automation-run-auto-close'
import { closeAgentChat } from './agent-chat-close'
import { sweepAutomationRunAutoCloseWith } from './automation-run-auto-close-service'
import { resetAutomationRunCloseDecisionsForTest } from './automation-run-close-decisions'
import { AUTOMATION_METHODS } from '../../runtime/rpc/methods/automations/automations'
import { formatAutomationRuns } from '../../../cli/automations/automation-format'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf-8'),
    decryptString: (ciphertext: Buffer) => ciphertext.toString('utf-8').slice('encrypted:'.length)
  }
}))

const CHAT = '5b0f6d3e-2a41-4c8e-9d17-3e6a0c4b8f21'
const MIN = 60_000
/** The run starts before its chat exists; the chat is created at HOST_TEST_NOW. */
const RUN_AT = HOST_TEST_NOW - 2 * MIN
const ENDED_AT = HOST_TEST_NOW + 10 * MIN

let rig: QueuedMessageTestRig
let store: Store

function research(input: Partial<Automation> = {}): Automation {
  store.addRepo({ id: 'r1', path: '/repo', displayName: 'repo', badgeColor: '#fff', addedAt: 1 })
  return store.createAutomation({
    name: 'Weekday research',
    prompt: 'Read the new papers and write a summary',
    agentId: 'codex',
    projectId: 'r1',
    workspaceMode: 'existing',
    workspaceId: 'r1::wt1',
    timezone: 'UTC',
    rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=8;BYMINUTE=0',
    dtstart: RUN_AT - 7 * 24 * 60 * MIN,
    reuseSession: input.reuseSession ?? false
  })
}

/** One run of the automation, launched into CHAT, finished when `ended` says so. */
function runInto(
  automation: Automation,
  ended: 'completed' | 'still-working' = 'completed',
  runAt = RUN_AT
) {
  vi.setSystemTime(runAt)
  const run = store.createAutomationRun(automation, runAt, 'manual')
  store.updateAutomationRun({
    runId: run.id,
    status: 'dispatched',
    sessionKind: 'chat',
    chatSessionId: CHAT,
    workspaceId: 'r1::wt1'
  })
  if (ended === 'completed') {
    store.updateAutomationRun({
      runId: run.id,
      status: 'completed',
      outputSnapshot: {
        format: 'plain_text',
        content: 'Summary written.',
        capturedAt: ENDED_AT,
        truncated: false
      }
    })
  }
  return run
}

async function turnSettledAt(at: number) {
  await rig.store.updateRecord(CHAT, {
    kind: 'last-turn',
    lastTurn: { state: 'settled', outcome: 'success', at, prompt: 'Read the new papers' }
  })
}

/** A message sent into the chat through the real host, recorded in its journal. */
async function personSendsAt(at: number) {
  vi.setSystemTime(at)
  expect(await rig.send('Also look at last week').result).toMatchObject({ ok: true })
}

function deps(now: number, homes: string[] = [], overrides: { working?: boolean } = {}) {
  const value = automationRunAutoCloseDeps(store, rig.store, () => new Set(homes))
  return {
    ...value,
    now: () => now,
    // The rig's provider never answers a send, so a case that sent says the agent finished it.
    ...(overrides.working === false ? { working: async () => false } : {})
  }
}

const tabOpen = () => rig.store.isSessionTabVisible(CHAT)

describe('auto-close of finished automation run chats', () => {
  beforeEach(async () => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-run-close-test-'))
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(RUN_AT)
    store = createStore()
    resetAutoClosedRegistryForTest()
    resetAutomationRunCloseDecisionsForTest()
    rig = await createQueuedMessageTestRig({ sessionId: CHAT })
    setStructuredAgentSessionHost(rig.host)
    await rig.host.setSessionTabVisibility(CHAT, true)
    await turnSettledAt(ENDED_AT - 5_000)
  })

  afterEach(async () => {
    setStructuredAgentSessionHost(null)
    await rig.dispose()
    await closeTestStores()
    vi.useRealTimers()
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('closes a finished fresh-session run after the grace, keeps its history, and mail reopens it', async () => {
    runInto(research())
    expect(tabOpen()).toBe(true)
    // Inside the grace (60 minutes unset) it stays.
    expect(
      await runAutomationRunAutoClosePass(deps(ENDED_AT + 30 * MIN), { dryRun: false })
    ).toEqual([])
    expect(tabOpen()).toBe(true)
    const rows = await runAutomationRunAutoClosePass(deps(ENDED_AT + 61 * MIN), { dryRun: false })
    expect(rows).toMatchObject([{ chatSessionId: CHAT, outcome: 'closed' }])
    expect(tabOpen()).toBe(false)
    expect(rig.store.getRecord(CHAT)).not.toBeNull()
    expect((await rig.host.history({ sessionId: CHAT, direction: 'tail' })).ok).toBe(true)
    expect(await isAutoClosedChat(CHAT)).toBe(true)
    // Opened again (mail, or from the run): the sweep leaves it open from then on.
    expect(await forkReopenAutoClosedChat(`orca_session_id:${CHAT}`)).toBe(true)
    expect(tabOpen()).toBe(true)
    await rig.host.setSessionTabVisibility(CHAT, true)
    expect(
      await runAutomationRunAutoClosePass(deps(ENDED_AT + 90 * MIN), { dryRun: false })
    ).toEqual([])
  })

  it('closes a run that ended days before the update on the first sweep', async () => {
    runInto(research())
    const rows = await runAutomationRunAutoClosePass(deps(ENDED_AT + 3 * 24 * 60 * MIN), {
      dryRun: false
    })
    expect(rows).toMatchObject([{ outcome: 'closed' }])
    expect(tabOpen()).toBe(false)
  })

  it.each([
    ['still working', () => runInto(research(), 'still-working'), 'running'],
    ['reuses one chat each run', () => runInto(research({ reuseSession: true })), 'reuse-session'],
    [
      'was typed into after the run ended',
      async () => {
        runInto(research())
        await personSendsAt(ENDED_AT + 20 * MIN)
        await turnSettledAt(ENDED_AT + 21 * MIN)
      },
      'typed'
    ],
    [
      'has a pinned tab',
      () => {
        runInto(research())
        store.setWorkspaceSession({
          ...store.getWorkspaceSession(),
          unifiedTabs: {
            'r1::wt1': [
              {
                id: 'tab-1',
                entityId: CHAT,
                groupId: 'g1',
                worktreeId: 'r1::wt1',
                contentType: 'agent-session',
                label: 'Weekday research',
                customLabel: null,
                color: null,
                sortOrder: 0,
                createdAt: RUN_AT,
                isPinned: true
              }
            ]
          }
        })
      },
      'pinned'
    ],
    [
      "is a bot's Home Chat",
      () => {
        runInto(research())
        return [CHAT]
      },
      'home'
    ],
    [
      'a person started before the run was sent into it',
      () => runInto(research(), 'completed', HOST_TEST_NOW + MIN),
      'person-chat'
    ]
  ] as const)('keeps a run chat that %s', async (_name, arrange, keep) => {
    const homes = await arrange()
    const later = ENDED_AT + 5 * 24 * 60 * MIN
    const rows = await runAutomationRunAutoClosePass(
      deps(later, Array.isArray(homes) ? homes : [], keep === 'typed' ? { working: false } : {}),
      {
        dryRun: false,
        includeKept: true
      }
    )
    expect(rows).toMatchObject([{ outcome: 'kept', keep }])
    expect(tabOpen()).toBe(true)
  })

  // The live keep (BAD-848 follow-up): a research run's background tasks woke the agent into turns
  // of its own after the run's turn ended. Those moved the chat's last turn past the run's end, and
  // the sweep read that as a person typing, so the tab never closed.
  it('closes a run whose agent ran on in turns of its own after the run ended', async () => {
    runInto(research())
    await turnSettledAt(ENDED_AT + 20 * MIN)
    const rows = await runAutomationRunAutoClosePass(deps(ENDED_AT + 3 * 24 * 60 * MIN), {
      dryRun: false,
      includeKept: true
    })
    expect(rows).toMatchObject([{ outcome: 'closed' }])
    expect(tabOpen()).toBe(false)
  })

  it('shows each run the sweep kept, and why, in automation.runs and orca automations runs', async () => {
    const automation = research()
    const run = runInto(automation)
    await personSendsAt(ENDED_AT + 20 * MIN)
    const value = { ...deps(ENDED_AT + 3 * 24 * 60 * MIN), working: async () => false }
    expect(await sweepAutomationRunAutoCloseWith(value)).toBe(false)
    const method = AUTOMATION_METHODS.find((entry) => entry.name === 'automation.runs')!
    const runtime = {
      listAutomationRuns: () => store.listAutomationRuns(),
      listAutomationRunsPage: () => ({ runs: store.listAutomationRuns(), nextCursor: null }),
      showAutomationRun: () => store.listAutomationRuns()[0]
    }
    const listed = (await method.handler({}, { runtime } as never)) as {
      runs: ReturnType<Store['listAutomationRuns']>
    }
    expect(listed.runs).toMatchObject([
      { id: run.id, forkTabClose: { outcome: 'kept', keep: 'typed' } }
    ])
    const paged = (await method.handler({ limit: 10 }, { runtime } as never)) as typeof listed
    expect(paged.runs[0]?.forkTabClose).toMatchObject({ outcome: 'kept', keep: 'typed' })
    expect(formatAutomationRuns(listed)).toContain('tab kept: typed')
    expect(tabOpen()).toBe(true)
    // The person's chat closes by hand; the next sweep says so.
    await rig.host.setSessionTabVisibility(CHAT, false)
    await sweepAutomationRunAutoCloseWith(value)
    const after = (await method.handler({}, { runtime } as never)) as typeof listed
    expect(formatAutomationRuns(after)).toContain('tab closed')
  })

  it('is off when forkAutomationRunAutoClose is false', async () => {
    runInto(research())
    store.updateSettings({ forkAutomationRunAutoClose: false })
    expect(
      await runAutomationRunAutoClosePass(deps(ENDED_AT + 5 * 24 * 60 * MIN), { dryRun: false })
    ).toEqual([])
    expect(tabOpen()).toBe(true)
  })

  it('orca agent close closes a finished chat through the same close, and refuses a working one', async () => {
    const runtime = { openAgentSessionRecordStore: async () => rig.store }
    await rig.store.updateRecord(CHAT, {
      kind: 'last-turn',
      lastTurn: { state: 'open', at: ENDED_AT, prompt: 'Read the new papers' }
    })
    expect(await closeAgentChat(runtime, { id: `orca_session_id:${CHAT}` })).toMatchObject({
      closed: false,
      reason: 'working'
    })
    expect(tabOpen()).toBe(true)
    await turnSettledAt(ENDED_AT + MIN)
    expect(await closeAgentChat(runtime, { id: `orca_session_id:${CHAT}` })).toEqual({
      closed: true,
      sessionId: CHAT
    })
    expect(tabOpen()).toBe(false)
    expect(rig.store.getRecord(CHAT)).not.toBeNull()
    // Not Orca's own close: mail does not reopen a chat a person closed.
    expect(await isAutoClosedChat(CHAT)).toBe(false)
  })
})
