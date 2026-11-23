// Fork tests (SLRM-2309, limit resume): when the sweep sends a continue. Kept apart from upstream's
// usage-limit continue tests, which upstream cut from its suite.
import { afterEach, expect, it } from 'vitest'
import {
  clearForkBoundaryCompactionTyped,
  setForkBoundaryCompactionTyped
} from '../../../../fork/boundary-compaction/boundary-compaction-typed'
import { RestartContinuationSupersededError } from '../../recovery/structured-agent-session-restart-continuation'
import { recordingStructuredAgentSessionLogger } from './structured-agent-session-logger.test-fixture'
import { StructuredAgentSessionUsageLimitContinue } from '../../recovery/structured-agent-session-usage-limit-continue'
import {
  HOST_TEST_NOW,
  hostTestRestingOptionsRecord
} from './structured-agent-session-host-test-data.test-fixture'

afterEach(() => {
  clearForkBoundaryCompactionTyped()
})

function sweepOver(
  open: { tabs: string[]; background: string[] },
  sent: string[],
  { loaded = true, now = HOST_TEST_NOW }: { loaded?: boolean; now?: number } = {}
): StructuredAgentSessionUsageLimitContinue {
  const ids = [...open.tabs, ...open.background]
  const cut = (id: string) => ({
    turnItemId: `${id}-turn`,
    resetsAt: HOST_TEST_NOW - 60_000,
    turnEndedAt: HOST_TEST_NOW - 120_000,
    chain: 0
  })
  return new StructuredAgentSessionUsageLimitContinue({
    host: {
      logger: recordingStructuredAgentSessionLogger().logger,
      usageLimitAutoContinue: {
        isEnabled: () => true,
        isWorkspaceAsleep: () => false,
        subscribe: () => () => {}
      },
      store: {
        hostId: 'local',
        listVisibleSessionIds: () => open.tabs,
        isSessionTabVisible: (id) => open.tabs.includes(id),
        listBackgroundSessionIds: () => open.background,
        isSessionInBackground: (id) => open.background.includes(id),
        cancelUsageLimitContinue: async (id) => hostTestRestingOptionsRecord(id),
        getRecord: (id) => hostTestRestingOptionsRecord(id)
      }
    },
    sessions: new Map(loaded ? ids.map((id) => [id, {}]) : []),
    readSavedCut: async (id) => (loaded ? null : cut(id)),
    readLoadedCut: async (id) => cut(id),
    serialize: (_id, run) => run(),
    // Each send is answered as superseded, which spends no budget; only who was sent matters here.
    send: async (params) => {
      params.beforeRun?.()
      sent.push(params.envelope.sessionId)
      throw new RestartContinuationSupersededError()
    },
    publish: () => {},
    now: () => now
  })
}

// Bot chats and kept-open structured workers run with no tab.
const TABLESS = { tabs: [], background: ['bot-chat', 'worker-chat'] }
const RESET = HOST_TEST_NOW - 60_000

it('waits out a restart before the continue time, then sends once it has passed', async () => {
  const before: string[] = []
  await sweepOver(TABLESS, before, { loaded: false, now: RESET - 30_000 }).tick()
  expect(before).toEqual([])
  // A new instance stands for the restarted app: nothing is kept from the first.
  const after: string[] = []
  await sweepOver(TABLESS, after, { loaded: false, now: RESET + 20_000 }).tick()
  expect(after).toEqual(['bot-chat', 'worker-chat'])
})

it('sends at once at startup when the continue time passed hours ago, but not after a day', async () => {
  const hours: string[] = []
  await sweepOver(TABLESS, hours, { loaded: false, now: RESET + 16 * 3_600_000 }).tick()
  expect(hours).toEqual(['bot-chat', 'worker-chat'])
  const days: string[] = []
  await sweepOver(TABLESS, days, { loaded: false, now: RESET + 25 * 3_600_000 }).tick()
  expect(days).toEqual([])
})

it('lets text left in a message box hold the continue only for 15 minutes past the reset', async () => {
  setForkBoundaryCompactionTyped(1, ['bot-chat'])
  const early: string[] = []
  await sweepOver(TABLESS, early, { now: RESET + 5 * 60_000 }).tick()
  expect(early).toEqual(['worker-chat'])
  const late: string[] = []
  await sweepOver(TABLESS, late, { now: RESET + 16 * 60_000 }).tick()
  expect(late).toEqual(['bot-chat', 'worker-chat'])
})
