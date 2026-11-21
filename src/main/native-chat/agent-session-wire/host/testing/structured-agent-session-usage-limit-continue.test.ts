import { readTestHostJournal } from '../../../agent-session-journal/journal-observation.test-support'
import { afterEach, expect, it } from 'vitest'
import {
  clearForkBoundaryCompactionTyped,
  setForkBoundaryCompactionTyped
} from '../../../../fork/boundary-compaction/boundary-compaction-typed'
import {
  createQueuedMessageTestRig,
  type QueuedMessageTestRig
} from './structured-agent-session-queued-message-rig.test-fixture'
import {
  appendRewindUsageLimitedTurn,
  appendUsageLimitedTurn
} from './structured-agent-session-rewind-usage-limit.test-fixture'
import { AGENT_JOURNAL_THREAD_SCOPE } from '../../../../../shared/agent-session/journal/agent-session-journal-types'
import { RestartContinuationSupersededError } from '../../recovery/structured-agent-session-restart-continuation'
import { recordingStructuredAgentSessionLogger } from './structured-agent-session-logger.test-fixture'
import { StructuredAgentSessionUsageLimitContinue } from '../../recovery/structured-agent-session-usage-limit-continue'
import { agentJournalSubmissionKey } from '../../../../../shared/agent-session/journal/agent-session-journal-item-key'
import {
  HOST_TEST_SESSION as SESSION,
  HOST_TEST_NOW,
  hostTestRestingOptionsRecord
} from './structured-agent-session-host-test-data.test-fixture'
import { eventually } from './structured-agent-session-queued-message-rig-provider.test-fixture'

let rig: QueuedMessageTestRig | undefined
afterEach(async () => {
  clearForkBoundaryCompactionTyped()
  await rig?.dispose()
})

it('automatically continues a failed usage-limited turn after its reset instead of queueing behind it', async () => {
  let clock = HOST_TEST_NOW
  rig = await createQueuedMessageTestRig({
    now: () => clock,
    usageLimitAutoContinue: {
      isEnabled: () => true,
      isWorkspaceAsleep: () => false,
      subscribe: () => () => {}
    }
  })
  const current = rig
  await current.store.setSessionTabVisibility(SESSION, true)
  const journal = current.host.collaboratorsForTests().sessions.get(SESSION)!.journal
  const cut = await appendRewindUsageLimitedTurn(journal, clock)
  clock = cut.resetsAt + 15_000
  await current.host.usageLimitContinue.tick()
  let continuationId: string | undefined
  await eventually(async () => {
    const snapshot = await readTestHostJournal(current.host, SESSION)
    continuationId = snapshot.submissions.find(
      (submission) => submission.handedOverAt !== undefined
    )?.clientMessageId
    expect(continuationId).toBeDefined()
  })
  await current.settleAccepted(continuationId!, 'continued')
  expect((await current.submission(continuationId!))?.dispatchState).toBe('accepted')
  expect(await current.drafts()).toEqual([])
  expect(await current.queuePause()).toBeNull()
})

it('stops automatically continuing once five continues in a row end in another usage limit', async () => {
  let clock = HOST_TEST_NOW
  rig = await createQueuedMessageTestRig({
    now: () => clock,
    usageLimitAutoContinue: {
      isEnabled: () => true,
      isWorkspaceAsleep: () => false,
      subscribe: () => () => {}
    }
  })
  const current = rig
  await current.store.setSessionTabVisibility(SESSION, true)
  const journal = current.host.collaboratorsForTests().sessions.get(SESSION)!.journal
  let cut = await appendRewindUsageLimitedTurn(journal, clock)
  const sent: string[] = []
  for (let round = 0; round < 8; round += 1) {
    clock = cut.resetsAt + 15_000
    await current.host.usageLimitContinue.tick()
    const snapshot = await readTestHostJournal(current.host, SESSION)
    const continuation = snapshot.submissions.find(
      (submission) => submission.origin === 'host' && !sent.includes(submission.clientMessageId)
    )
    if (!continuation) {
      break
    }
    sent.push(continuation.clientMessageId)
    await current.settleAccepted(continuation.clientMessageId, `continued-${round}`)
    const accepted = await current.submission(continuation.clientMessageId)
    // Claude's echo opens a turn under the provider's item; output-first turns key the submission.
    const userItemId =
      round % 2 === 1 && accepted?.providerItemId
        ? accepted.providerItemId
        : agentJournalSubmissionKey(continuation.clientMessageId)
    cut = await appendUsageLimitedTurn(journal, clock, `refail-${round}`, userItemId)
  }
  expect(sent).toHaveLength(5)
  expect(
    current.host.usageLimitContinue.readState(SESSION, await journal.reads.usageLimitCut())?.state
  ).toBe('failed')
})

function sweepOver(
  open: { tabs: string[]; background: string[] },
  sent: string[],
  {
    enabled = true,
    loaded = true,
    unreadable = [],
    now = HOST_TEST_NOW
  }: { enabled?: boolean; loaded?: boolean; unreadable?: readonly string[]; now?: number } = {}
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
        isEnabled: () => enabled,
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
    readLoadedCut: async (id) => {
      if (unreadable.includes(id)) {
        throw new Error('database disk image is malformed')
      }
      return cut(id)
    },
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

it('continues both visible and tabless chats whose limit reset in the same pass', async () => {
  const sent: string[] = []
  await sweepOver({ ...TABLESS, tabs: ['chat-a'] }, sent).tick()
  expect(sent).toEqual(['chat-a', 'bot-chat', 'worker-chat'])
})

it('continues no tabless chat while automatic continue is off', async () => {
  const sent: string[] = []
  await sweepOver(TABLESS, sent, { enabled: false }).tick()
  expect(sent).toEqual([])
})

it('continues tabless chats that are not loaded, as after a restart or a released run', async () => {
  const sent: string[] = []
  await sweepOver(TABLESS, sent, { loaded: false }).tick()
  expect(sent).toEqual(['bot-chat', 'worker-chat'])
})

it('still continues the other chats when one chat cannot be read', async () => {
  const sent: string[] = []
  const sweep = sweepOver({ tabs: ['chat-a', 'chat-corrupt', 'chat-c'], background: [] }, sent, {
    unreadable: ['chat-corrupt']
  })
  await sweep.tick()
  expect(sent).toEqual(['chat-a', 'chat-c'])
})

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

it('continues a failed chat that has mail queued behind its failure, then drains the mail in order', async () => {
  let clock = HOST_TEST_NOW
  rig = await createQueuedMessageTestRig({
    now: () => clock,
    usageLimitAutoContinue: {
      isEnabled: () => true,
      isWorkspaceAsleep: () => false,
      subscribe: () => () => {}
    }
  })
  const current = rig
  await current.store.setSessionTabVisibility(SESSION, true)
  const journal = current.host.collaboratorsForTests().sessions.get(SESSION)!.journal
  const cut = await appendRewindUsageLimitedTurn(journal, clock)
  const from = { kind: 'agent' as const, senders: [], orchestration: null }
  await current.send('first report', 'queue-if-active', { internal: true, from }).result
  await current.send('second report', 'queue-if-active', { internal: true, from }).result
  expect((await current.drafts()).map((draft) => draft.state)).toEqual(['waiting', 'waiting'])
  clock = cut.resetsAt + 15_000
  await current.host.usageLimitContinue.tick()
  let continuationId: string | undefined
  await eventually(async () => {
    const snapshot = await readTestHostJournal(current.host, SESSION)
    continuationId = snapshot.submissions.find(
      (submission) => submission.origin === 'host' && submission.handedOverAt !== undefined
    )?.clientMessageId
    expect(continuationId).toBeDefined()
  })
  await current.settleAccepted(continuationId!, 'continued')
  // The continued turn finishes: a newer turn than the failure lifts the hold on the mail.
  await journal.appendItem(
    { provider: 'orca', clientMessageId: 'turn-continued' },
    {
      kind: 'turn',
      turnId: 'continued-turn',
      providerTurnId: 'continued-turn',
      state: 'completed',
      outcome: 'success',
      startedAt: clock,
      completedAt: clock
    },
    { fence: 1, turnScope: AGENT_JOURNAL_THREAD_SCOPE }
  )
  await eventually(async () => {
    expect(await current.queuePause()).toBeNull()
    // The first report is handed over behind the continue; the second waits its turn.
    const snapshot = await readTestHostJournal(current.host, SESSION)
    expect(snapshot.submissions.filter((sent) => sent.handedOverAt !== undefined)).toHaveLength(2)
    expect(await current.drafts()).toHaveLength(1)
  })
})
