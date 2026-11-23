import { beforeEach, describe, expect, it, vi } from 'vitest'
import { structuredAgentSessionTabId } from '../../../shared/agent-session/view/structured-agent-session-projection'
import { buildIdleRecoveryWakeMessage } from '../../../shared/fork/idle-recovery'
import {
  ORCA_DISPATCH_PROMPT_LEAD_LINE,
  ORCA_DISPATCH_STATUS_PREAMBLE_PREFIX
} from '../../../shared/orchestration/workers/orca-dispatch-status-prompt'
import { forkNoteBackgroundRuns } from '../background-runs/background-run-status'
import {
  isOrchestrationPrompt,
  listIdleRecoveryCandidates,
  listIdleRecoveryCandidatesWith
} from './idle-recovery-candidates'
import { clearIdleRecoveryEndingCache } from './idle-recovery-ending'
import { buildIdleRecoveryRoleIndex } from './idle-recovery-roles'
import {
  NOW,
  agentRow,
  fakeHost,
  journalMessage,
  psWorktree,
  settingsFor
} from './idle-recovery-test-fixtures'

const CHAT_PANE = `${structuredAgentSessionTabId('chat-1')}:leaf-9`

function chatHost(agents = [agentRow({ paneKey: CHAT_PANE })]) {
  return fakeHost([psWorktree(agents)], {
    chatFacts: () => new Map([['chat-1', { model: null }]]),
    chatSummary: () => ({ launchDirectory: '/invented/launch', backgroundRunning: false })
  })
}

beforeEach(() => {
  clearIdleRecoveryEndingCache()
})

describe('listIdleRecoveryCandidates', () => {
  it('reads nothing while the mode is off', async () => {
    const worktreePs = vi.fn(async () => [psWorktree([agentRow()])])
    const host = fakeHost([], { worktreePs })
    expect(await listIdleRecoveryCandidatesWith(host, settingsFor({ mode: 'off' }), NOW)).toEqual(
      []
    )
    expect(await listIdleRecoveryCandidates(settingsFor({ mode: 'off' }), NOW)).toEqual([])
    expect(worktreePs).not.toHaveBeenCalled()
  })

  it('lists a terminal agent whose turn ended past the idle window', async () => {
    const host = fakeHost([psWorktree([agentRow()])])
    expect(await listIdleRecoveryCandidatesWith(host, settingsFor(), NOW)).toEqual([
      {
        chatId: 'tab-1:leaf-1',
        kind: 'terminal',
        agent: 'claude',
        cwd: '/invented/garden',
        title: 'tidy the changelog',
        workspace: 'garden',
        worktreeId: 'wt-1',
        role: 'standalone',
        requestSource: 'user',
        lastPrompt: 'tidy the changelog',
        idleSince: NOW - 120_000,
        backgroundPending: false,
        scheduledWake: false,
        coordinatorBusy: false
      }
    ])
  })

  it('lists a native chat by its session id, with its launch folder', async () => {
    const [candidate] = await listIdleRecoveryCandidatesWith(chatHost(), settingsFor(), NOW)
    expect(candidate).toMatchObject({ chatId: 'chat-1', kind: 'chat', cwd: '/invented/launch' })
  })

  it('leaves out a bot look-around or tidy-up, which no owner can open (BAD-795)', async () => {
    forkNoteBackgroundRuns((id) => id === 'chat-1')
    try {
      expect(await listIdleRecoveryCandidatesWith(chatHost(), settingsFor(), NOW)).toEqual([])
    } finally {
      forkNoteBackgroundRuns(() => false)
    }
  })

  it('leaves out chats that are not idle long enough, mid-turn, asking, asleep or remote', async () => {
    const host = fakeHost([
      psWorktree([
        agentRow({ paneKey: 't:recent', stateStartedAt: NOW - 30_000 }),
        agentRow({ paneKey: 't:working', state: 'working' }),
        agentRow({ paneKey: 't:blocked', state: 'blocked' }),
        agentRow({ paneKey: 't:waiting', state: 'waiting' }),
        agentRow({ paneKey: 't:asleep', hasLivePty: undefined }),
        // A chat this host has not loaded has no provider process: it is asleep.
        agentRow({ paneKey: CHAT_PANE })
      ]),
      psWorktree([agentRow({ paneKey: 't:remote' })], { worktreeId: 'wt-2', hostId: 'ssh:far' })
    ])
    expect(await listIdleRecoveryCandidatesWith(host, settingsFor(), NOW)).toEqual([])
  })

  it('leaves out paused chats, stalled chats and turns the user stopped', async () => {
    const host = fakeHost(
      [
        psWorktree([
          agentRow({ paneKey: 't:paused' }),
          agentRow({ paneKey: 't:stopped', interrupted: true }),
          agentRow({
            paneKey: 't:cancelled',
            mainAgent: { state: 'done', outcome: 'cancellation', stateStartedAt: NOW - 120_000 }
          }),
          agentRow({ paneKey: CHAT_PANE })
        ])
      ],
      {
        chatFacts: () => new Map([['chat-1', { model: null }]]),
        lifecycle: () => ({
          stalled: new Map([['chat-1', { quietSince: NOW - 1000, liveness: 'alive' as const }]])
        })
      }
    )
    const settings = settingsFor({ paused: ['t:paused'] })
    expect(await listIdleRecoveryCandidatesWith(host, settings, NOW)).toEqual([])
  })

  it('lists a done agent held working by background work as background pending', async () => {
    const host = fakeHost([
      psWorktree([
        agentRow({
          state: 'working',
          workingMode: 'monitoring',
          stateStartedAt: NOW - 500_000,
          mainAgent: { state: 'done', stateStartedAt: NOW - 90_000 }
        })
      ])
    ])
    const [candidate] = await listIdleRecoveryCandidatesWith(host, settingsFor(), NOW)
    expect(candidate).toMatchObject({ backgroundPending: true, idleSince: NOW - 90_000 })
  })

  it('reports a running background task of a native chat', async () => {
    const host = chatHost()
    host.chatSummary = () => ({ launchDirectory: null, backgroundRunning: true })
    const [candidate] = await listIdleRecoveryCandidatesWith(host, settingsFor(), NOW)
    expect(candidate).toMatchObject({ backgroundPending: true, cwd: '/invented/garden' })
  })

  it('skips workers unless workers are included', async () => {
    const host = fakeHost(
      [
        psWorktree([
          agentRow({ paneKey: 't:lead' }),
          agentRow({ paneKey: 't:child', parentPaneKey: 't:lead' }),
          agentRow({ paneKey: 't:assignee' })
        ])
      ],
      {
        dispatchRows: async () => [
          {
            assignee_pane_key: 't:assignee',
            assignee_orca_session_id: null,
            creator_pane_key: 't:lead',
            creator_orca_session_id: null,
            status: 'completed'
          }
        ]
      }
    )
    const skipped = await listIdleRecoveryCandidatesWith(host, settingsFor(), NOW)
    expect(skipped.map((c) => [c.chatId, c.role, c.coordinatorBusy])).toEqual([
      ['t:lead', 'coordinator', false]
    ])
    const included = await listIdleRecoveryCandidatesWith(
      host,
      settingsFor({ workers: 'include' }),
      NOW
    )
    expect(included.map((c) => [c.chatId, c.role])).toEqual([
      ['t:lead', 'coordinator'],
      ['t:child', 'worker'],
      ['t:assignee', 'worker']
    ])
  })

  it('marks a coordinator busy for an open dispatch or a child still in a turn', async () => {
    const open = fakeHost([psWorktree([agentRow({ paneKey: 't:lead' })])], {
      dispatchRows: async () => [
        {
          assignee_pane_key: 't:gone',
          assignee_orca_session_id: null,
          creator_pane_key: 't:lead',
          creator_orca_session_id: null,
          status: 'dispatched'
        }
      ]
    })
    expect((await listIdleRecoveryCandidatesWith(open, settingsFor(), NOW))[0]).toMatchObject({
      role: 'coordinator',
      coordinatorBusy: true
    })
    const child = fakeHost([
      psWorktree([
        agentRow({ paneKey: 't:lead' }),
        agentRow({ paneKey: 't:child', parentPaneKey: 't:lead', state: 'working' })
      ])
    ])
    expect((await listIdleRecoveryCandidatesWith(child, settingsFor(), NOW))[0]).toMatchObject({
      chatId: 't:lead',
      coordinatorBusy: true
    })
  })

  it('tells who asked for the turn', async () => {
    const dispatch = `${ORCA_DISPATCH_PROMPT_LEAD_LINE}\n${ORCA_DISPATCH_STATUS_PREAMBLE_PREFIX} rest`
    const host = fakeHost([
      psWorktree([
        agentRow({ paneKey: 't:user' }),
        agentRow({ paneKey: 't:wake', prompt: buildIdleRecoveryWakeMessage('carry on') }),
        agentRow({ paneKey: 't:dispatch', prompt: dispatch }),
        agentRow({
          paneKey: 't:mail',
          prompt: '\nYou have 2 orchestration messages. Run `orca orchestration check`.\n'
        })
      ]),
      psWorktree([agentRow({ paneKey: 't:auto' })], { worktreeId: 'wt-2', automationCreated: true })
    ])
    const candidates = await listIdleRecoveryCandidatesWith(host, settingsFor(), NOW)
    expect(candidates.map((c) => [c.chatId, c.requestSource])).toEqual([
      ['t:user', 'user'],
      ['t:wake', 'wake'],
      ['t:dispatch', 'orchestration'],
      ['t:mail', 'orchestration'],
      ['t:auto', 'automation']
    ])
  })

  it("reads a native chat's sender from its journal once per ending", async () => {
    const chatJournal = vi.fn(async () => [
      journalMessage('user', 'the worker reported', {}, { from: { kind: 'agent', senders: [] } }),
      journalMessage('assistant', 'noted, I will merge it next')
    ])
    const host = chatHost()
    host.chatJournal = chatJournal
    for (let sweep = 0; sweep < 3; sweep += 1) {
      const [candidate] = await listIdleRecoveryCandidatesWith(host, settingsFor(), NOW + sweep)
      expect(candidate?.requestSource).toBe('orchestration')
    }
    expect(chatJournal).toHaveBeenCalledTimes(1)
  })

  it('lists 2000 agents in a few milliseconds beyond the row read', async () => {
    const worktrees = Array.from({ length: 200 }, (_, w) =>
      psWorktree(
        Array.from({ length: 10 }, (_, a) =>
          agentRow({ paneKey: `tab-${w}:leaf-${a}`, state: a % 2 ? 'done' : 'working' })
        ),
        { worktreeId: `wt-${w}` }
      )
    )
    const dispatches = Array.from({ length: 500 }, (_, d) => ({
      assignee_pane_key: `tab-${d % 200}:leaf-1`,
      assignee_orca_session_id: null,
      creator_pane_key: `tab-${d % 200}:leaf-3`,
      creator_orca_session_id: null,
      status: 'completed'
    }))
    const host = fakeHost(worktrees, { dispatchRows: async () => dispatches })
    const settings = settingsFor({ workers: 'include' })
    await listIdleRecoveryCandidatesWith(host, settings, NOW)
    const runs = 20
    const started = performance.now()
    let listed = 0
    for (let run = 0; run < runs; run += 1) {
      listed = (await listIdleRecoveryCandidatesWith(host, settings, NOW)).length
    }
    const perListing = (performance.now() - started) / runs
    console.log(`idle recovery listing: ${perListing.toFixed(2)} ms for 2000 rows, ${listed} idle`)
    expect(listed).toBe(1000)
    expect(perListing).toBeLessThan(250)
  })
})

describe('isOrchestrationPrompt', () => {
  it('knows the mailbox pointers and not a look-alike the user typed', () => {
    expect(isOrchestrationPrompt('You have 1 orchestration message. Run it.')).toBe(true)
    expect(isOrchestrationPrompt('You have new orchestration messages. Read them.')).toBe(true)
    expect(isOrchestrationPrompt('You have 3 new orchestration messages after delivery d1')).toBe(
      true
    )
    expect(isOrchestrationPrompt('do you have orchestration messages for me?')).toBe(false)
  })
})

describe('buildIdleRecoveryRoleIndex', () => {
  it('matches a native chat by session id and ignores a self dispatch', () => {
    const roleOf = buildIdleRecoveryRoleIndex([
      {
        assignee_pane_key: null,
        assignee_orca_session_id: 'chat-w',
        creator_pane_key: null,
        creator_orca_session_id: 'chat-c',
        status: 'pending'
      },
      {
        assignee_pane_key: 't:self',
        assignee_orca_session_id: null,
        creator_pane_key: 't:self',
        creator_orca_session_id: null,
        status: 'dispatched'
      }
    ])
    expect(roleOf({ paneKey: 'x:1', sessionId: 'chat-w' })).toEqual({
      role: 'worker',
      openDispatches: false
    })
    expect(roleOf({ paneKey: 'x:2', sessionId: 'chat-c' })).toEqual({
      role: 'coordinator',
      openDispatches: true
    })
    expect(roleOf({ paneKey: 't:self', sessionId: null }).role).toBe('standalone')
  })
})
