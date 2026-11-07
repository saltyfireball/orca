import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionStatusSummary } from '../../../shared/agent-session/agent-session-wire'
import type { AgentSessionRecord } from '../../../shared/agent-session/lifecycle/agent-session-record'
import { agentSessionRecordFixture } from '../../native-chat/agent-session-record-test-fixture'
import { ClaudeAccountMoveService, type ClaudeAccountMoveDeps } from './claude-account-move-service'
import type { ClaudeSessionPin } from './claude-session-account-pins'

const SYSTEM = '/fake/home/.claude'
const home = (id: string): string => `/fake/accounts/${id}`

type FakeHost = {
  deps: ClaudeAccountMoveDeps
  pins: Map<string, ClaudeSessionPin>
  running: Map<string, string>
  status: Map<string, AgentSessionStatusSummary['status']>
}

/** One host's chats and accounts. A remote runtime is the same service on its own host. */
function fakeHost(input: {
  hostName: string
  accounts: string[]
  records: AgentSessionRecord[]
  selected?: string | null
  isolated?: string[]
}): FakeHost {
  const pins = new Map<string, ClaudeSessionPin>()
  const running = new Map<string, string>()
  const status = new Map<string, AgentSessionStatusSummary['status']>()
  const deps: ClaudeAccountMoveDeps = {
    hostName: input.hostName,
    records: () => input.records,
    record: (id) => input.records.find((record) => record.sessionId === id) ?? null,
    inView: () => true,
    summary: (id) => {
      const record = input.records.find((entry) => entry.sessionId === id)
      if (!record) {
        return undefined
      }
      const summary: AgentSessionStatusSummary = {
        sessionId: id,
        workspaceId: record.location.workspaceId,
        agent: 'claude',
        status: status.get(id) ?? 'idle',
        latestPrompt: '',
        updatedAt: 1
      }
      if (running.has(id)) {
        summary.hostExecutionOwned = true
      }
      return summary
    },
    runningHome: (id) => running.get(id),
    launchHome: (record) => ({ home: running.get(record.sessionId) ?? SYSTEM, accountId: null }),
    accountLabel: (id) => (input.accounts.includes(id) ? `${id}@example.test` : undefined),
    route: (pin) => {
      if (pin === null) {
        return { kind: 'system' }
      }
      return input.accounts.includes(pin)
        ? { kind: 'account', accountId: pin, home: home(pin) }
        : null
    },
    systemHome: () => SYSTEM,
    selectedAccountId: () => input.selected ?? null,
    sharesHistory: (_from, to) => !(input.isolated ?? []).some((id) => home(id) === to),
    prepareAccount: vi.fn(async () => {}),
    pins: {
      get: (id) => (pins.has(id) ? (pins.get(id) ?? null) : undefined),
      set: (id, pin) => (pin === undefined ? pins.delete(id) : pins.set(id, pin))
    },
    stopTurn: vi.fn(async () => true)
  }
  return { deps, pins, running, status }
}

function chat(sessionId: string, workspaceId: string, extra: Partial<AgentSessionRecord> = {}) {
  return agentSessionRecordFixture({ sessionId, location: { workspaceId }, ...extra })
}

describe('ClaudeAccountMoveService', () => {
  it('moves one idle chat and leaves the others on the selection', async () => {
    const host = fakeHost({
      hostName: 'mac',
      accounts: ['a', 'b'],
      selected: 'a',
      records: [chat('s1', 'w1'), chat('s2', 'w1')]
    })
    host.running.set('s1', home('a'))
    host.running.set('s2', home('a'))
    const service = new ClaudeAccountMoveService(host.deps)
    const moved = await service.move({ accountId: 'b', sessionId: 's1' })
    expect(moved.results).toEqual([{ sessionId: 's1', name: 's1', status: 'moved' }])
    expect([...host.pins]).toEqual([['s1', 'b']])
    expect(service.which({ worktree: 'w1' }).sessions).toMatchObject([
      { sessionId: 's1', accountId: 'b', runningAccountId: 'a', pinned: true, host: 'mac' },
      { sessionId: 's2', accountId: 'a', runningAccountId: 'a', pinned: false }
    ])
  })

  it('queues a busy chat until its turn ends, stops it only with now, and cancels back', async () => {
    const host = fakeHost({ hostName: 'mac', accounts: ['a', 'b'], records: [chat('s1', 'w1')] })
    host.running.set('s1', home('a'))
    host.status.set('s1', 'working')
    const service = new ClaudeAccountMoveService(host.deps)

    const queued = await service.move({ accountId: 'b', sessionId: 's1' })
    expect(queued.results[0]).toMatchObject({ status: 'queued', busy: 'turn' })
    expect(host.deps.stopTurn).not.toHaveBeenCalled()
    expect(service.which({ sessionId: 's1' }).sessions[0]).toMatchObject({ pending: true })

    expect(service.cancel('s1')).toEqual({ cancelled: true })
    expect(host.pins.has('s1')).toBe(false)

    const now = await service.move({ accountId: 'b', sessionId: 's1', now: true })
    expect(now.results[0]).toMatchObject({ status: 'moved', stopped: true })
    expect(host.deps.stopTurn).toHaveBeenCalledTimes(1)

    // Once the provider runs on the new account, nothing is pending.
    host.running.set('s1', home('b'))
    expect(service.which({ sessionId: 's1' }).sessions[0]).toMatchObject({ pending: false })
  })

  it('says why a chat cannot move', async () => {
    const host = fakeHost({
      hostName: 'mac',
      accounts: ['a', 'b', 'solo'],
      isolated: ['solo'],
      records: [
        chat('codex', 'w1', { provider: 'codex' }),
        chat('wsl', 'w1', { location: { ...chat('x', 'w1').location, wslDistro: 'Ubuntu' } }),
        chat('s1', 'w1')
      ]
    })
    host.running.set('s1', home('a'))
    const service = new ClaudeAccountMoveService(host.deps)
    const reason = async (sessionId: string, accountId: string | null) =>
      (await service.move({ accountId, sessionId })).results[0]
    expect(await reason('nope', 'b')).toMatchObject({ reason: 'not-found' })
    expect(await reason('codex', 'b')).toMatchObject({ reason: 'not-claude' })
    expect(await reason('wsl', 'b')).toMatchObject({ reason: 'wsl-chat' })
    expect(await reason('s1', 'gone')).toMatchObject({ reason: 'unknown-account' })
    expect(await reason('s1', 'solo')).toMatchObject({ reason: 'history-not-shared' })
    expect(await reason('s1', 'a')).toMatchObject({ status: 'unchanged' })
    expect(await reason('s1', null)).toMatchObject({ status: 'moved' })
    expect(host.pins.get('s1')).toBeNull()
  })

  it('moves a whole worktree on a remote host with only that host accounts and chats', async () => {
    const local = fakeHost({ hostName: 'mac', accounts: ['a'], records: [chat('l1', 'w1')] })
    const remote = fakeHost({
      hostName: 'devbox',
      accounts: ['r1', 'r2'],
      records: [chat('r-s1', 'w1'), chat('r-s2', 'w1'), chat('r-s3', 'w2')]
    })
    for (const id of ['r-s1', 'r-s2', 'r-s3']) {
      remote.running.set(id, home('r1'))
    }
    remote.status.set('r-s2', 'working')
    const service = new ClaudeAccountMoveService(remote.deps)

    // The local account does not exist on the remote host.
    expect((await service.move({ accountId: 'a', worktree: 'w1' })).results).toMatchObject([
      { sessionId: 'r-s1', reason: 'unknown-account' },
      { sessionId: 'r-s2', reason: 'unknown-account' }
    ])
    const moved = await service.move({ accountId: 'r2', worktree: 'w1' })
    expect(moved.host).toBe('devbox')
    expect(moved.results).toMatchObject([
      { sessionId: 'r-s1', status: 'moved' },
      { sessionId: 'r-s2', status: 'queued', busy: 'turn' }
    ])
    expect(remote.pins.has('r-s3')).toBe(false)
    expect(local.pins.size).toBe(0)
  })
})
