import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentSessionStatusSummary } from '../../../shared/agent-session/agent-session-wire'
import type { AgentJournalItemBody } from '../../../shared/agent-session/journal/agent-session-journal-types'
import { codexProviderHandle } from '../../../shared/agent-session/lifecycle/provider-handles/agent-session-provider-handle-encoding'
import { structuredAgentSessionAgentStatus } from '../../../shared/agent-session/view/structured-agent-session-agent-status'
import { botStructuredSessionWiring } from '../../bots/bot-structured-session-wiring'
import { createTrackedJournalOpener } from '../../native-chat/agent-session-journal/store-lifecycle/journal-host-database-test-support'
import { createStructuredAgentSessionLogger } from '../../native-chat/agent-session-wire/host/structured-agent-session-logger'
import { StructuredAgentSessionStatusFeed } from '../../native-chat/agent-session-wire/observations/structured-agent-session-status-feed'
import { indexedStatusFeedSession } from '../../native-chat/agent-session-wire/observations/testing/structured-agent-session-status-feed-test-session.test-fixture'
import { forkNoteBackgroundRuns, forkPublishedStatusSummary } from './background-run-status'

const journals = createTrackedJournalOpener()
const roots: string[] = []

afterEach(async () => {
  forkNoteBackgroundRuns(() => null)
  await journals.closeAll()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

/** A host's own bots wiring, where `look-1` is a look-around and `tidy-1` a tidy-up. */
function wireBots(): void {
  const wiring = botStructuredSessionWiring({
    lookAround: {
      botOfLook: (id: string) => (id === 'look-1' ? 'bot-1' : null),
      botOfTidyUp: (id: string) => (id === 'tidy-1' ? 'bot-1' : null),
      lookTurnIsQuiet: () => false
    },
    store: () => ({ getBots: () => [], getRepos: () => [] }),
    bots: {},
    chats: {},
    work: {}
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the look-around store is read here.
  } as unknown as Parameters<typeof botStructuredSessionWiring>[0])
  // The host still gets the answer it asked for.
  expect(wiring.readOnlySession('look-1')).toBe('look-around')
  expect(wiring.readOnlySession('tidy-1')).toBe('reply-only')
  expect(wiring.readOnlySession('chat-1')).toBeNull()
}

const PENDING = {
  state: 'pending' as const,
  selectedOptionId: null,
  resolvedBy: null,
  resolvedAt: null
}
const APPROVAL: AgentJournalItemBody = {
  kind: 'approval',
  title: 'Run command?',
  detail: null,
  options: [{ id: 'yes', label: 'Allow' }],
  resolution: PENDING
}

/** What the real feed broadcasts for a chat whose turn stopped on an approval. */
async function publishedSummary(
  sessionId: string,
  running: boolean
): Promise<AgentSessionStatusSummary> {
  const root = await mkdtemp(join(tmpdir(), 'background-run-'))
  roots.push(root)
  const journal = await journals.open({
    stateDirectory: root,
    now: () => 1,
    identity: {
      sessionId,
      workspaceId: 'workspace-1',
      hostId: 'local',
      agent: 'codex',
      providerHandle: codexProviderHandle('native-1')
    }
  })
  const bodies: AgentJournalItemBody[] = [
    { kind: 'message', role: 'user', blocks: [{ type: 'text', text: 'look around' }] },
    { kind: 'status', text: 'Working', turnLifecycle: { turnId: 'turn-1', state: 'running' } },
    APPROVAL
  ]
  for (const [ordinal, body] of bodies.entries()) {
    await journal.appendItem(
      { provider: 'codex', threadId: 'native-1', turnId: 'turn-1', ordinal },
      body,
      { fence: 0, turnScope: { kind: 'thread' } }
    )
  }
  const child = running ? { phase: 'ready' as const } : null
  const feed = new StructuredAgentSessionStatusFeed({
    logger: createStructuredAgentSessionLogger(),
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the feed reads only the child's phase here.
    sessions: new Map([[sessionId, indexedStatusFeedSession({ journal, child: child as never })]]),
    getConversation: () => null,
    now: () => 1_000
  })
  const heard: AgentSessionStatusSummary[] = []
  feed.subscribe({
    id: 'window',
    emit: (event) => {
      if (event.type === 'status') {
        heard.push(event.session)
      }
    }
  })
  await feed.publish(sessionId, journal)
  expect(feed.readPublished(sessionId)).toEqual(heard.at(-1))
  return heard.at(-1)!
}

/** The state every list draws: rows, badges, the status bar, the dashboard and the phone. */
const rowState = (summary: AgentSessionStatusSummary) =>
  structuredAgentSessionAgentStatus({ ...summary, status: summary.status ?? 'idle' }).state

describe('background runs and the owner (BAD-795)', () => {
  it('a chat of the bot that stops on an approval waits on the owner', async () => {
    wireBots()
    const summary = await publishedSummary('chat-1', true)
    expect(summary).toMatchObject({ status: 'attention', awaitsApproval: { tool: 'Run command?' } })
    expect(rowState(summary)).toBe('blocked')
  })

  it.each(['look-1', 'tidy-1'])('%s stopped on an approval is a run at work', async (sessionId) => {
    wireBots()
    const summary = await publishedSummary(sessionId, true)
    expect(summary.status).toBe('working')
    expect(summary.awaitsApproval).toBeUndefined()
    expect(rowState(summary)).toBe('working')
  })

  it('with no process left it is over', async () => {
    wireBots()
    const summary = await publishedSummary('look-1', false)
    expect(summary.status).toBe('idle')
    expect(rowState(summary)).toBe('done')
  })

  it('a question it left open asks no one, and its own words stay', () => {
    const summary: AgentSessionStatusSummary = {
      sessionId: 'look-1',
      workspaceId: 'w',
      agent: 'codex',
      status: 'idle',
      latestPrompt: 'look around',
      lastAssistantMessage: 'Shall I go on?',
      awaitsAnswer: true,
      awaitsQuestion: { itemId: 'q1', text: 'Shall I go on?' },
      updatedAt: 1
    }
    expect(forkPublishedStatusSummary(summary)).toBe(summary)
    wireBots()
    const { awaitsAnswer: _a, awaitsQuestion: _q, ...quiet } = summary
    expect(forkPublishedStatusSummary(summary)).toEqual(quiet)
    expect(rowState(summary)).toBe('waiting')
    expect(rowState(forkPublishedStatusSummary(summary))).toBe('done')
  })
})
