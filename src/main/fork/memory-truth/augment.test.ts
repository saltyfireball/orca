import { afterEach, describe, expect, it } from 'vitest'
import { buildProcessIndex, type ProcRow } from '../../memory/process-index'
import type { MemorySnapshotStore } from '../../memory/memory-snapshot-buckets'
import type { MemorySnapshot } from '../../../shared/process-stats-types'
import { forkAugmentMemorySnapshot, resetForkMemoryAugmentForTests } from './augment'
import { chatRootsFromRecords, chatWorkspaceKey, type ForkChatRecordView } from './chat-roots'
import type { ForkProcRow } from './process-table'

const MB = 1024 * 1024
const APP = 100
const DAEMON = 200

function rows(specs: [number, number, number, string, number][]): ForkProcRow[] {
  return specs.map(([pid, ppid, pgid, name, mb]) => ({
    pid,
    ppid,
    pgid,
    name,
    cpu: 0,
    memory: mb * MB
  }))
}

const store: MemorySnapshotStore = {
  getRepo: (() => ({ displayName: 'demo-repo' })) as never,
  getWorktreeMeta: (() => ({ displayName: 'feature' })) as never
}

function upstreamSnapshot(): MemorySnapshot {
  const zero = () => ({ cpu: 0, memory: 0 })
  return {
    app: {
      cpu: 0,
      memory: 450 * MB,
      main: { cpu: 0, memory: 300 * MB },
      renderer: { cpu: 0, memory: 100 * MB },
      other: { cpu: 0, memory: 50 * MB },
      history: []
    },
    worktrees: [
      {
        worktreeId: 'repo-1::/w/feature',
        worktreeName: 'feature',
        repoId: 'repo-1',
        repoName: 'demo-repo',
        ...zero(),
        memory: 5 * MB,
        sessions: [{ sessionId: 's1', paneKey: null, pid: 300, cpu: 0, memory: 5 * MB }],
        history: []
      }
    ],
    host: {} as MemorySnapshot['host'],
    processMemoryMetric: 'footprint',
    totalCpu: 0,
    totalMemory: 455 * MB,
    collectedAt: 1
  }
}

const TABLE = rows([
  [1, 0, 1, 'launchd', 0],
  [APP, 1, APP, 'orca', 300],
  [101, APP, APP, 'orca helper', 100],
  [DAEMON, 1, DAEMON, 'node', 50],
  [300, DAEMON, 300, 'zsh', 5],
  // The agent's MCP server already left its tree.
  [302, 1, 300, 'node', 200],
  [400, APP, 400, 'claude', 900],
  [401, 400, 400, 'node', 100]
])

const deps = {
  electronPids: () => new Set([APP, 101]),
  appPid: APP,
  daemonPid: () => DAEMON,
  linuxPss: false,
  sampleSystem: async () => null,
  chatRoots: () =>
    chatRootsFromRecords(
      [
        {
          sessionId: 'c1',
          provider: 'claude',
          location: {
            executionHostId: 'local',
            wslDistro: null,
            workspaceId: 'repo-1::/w/feature',
            workspaceKind: 'git-worktree'
          },
          lease: { claimStatus: 'live', ownerProcess: { hostId: 'h', pid: 400 } }
        }
      ],
      'h'
    )
}

afterEach(() => resetForkMemoryAugmentForTests())

describe('forkAugmentMemorySnapshot', () => {
  it('adds chats and orphans, and makes the totals and rows agree', async () => {
    const index = buildProcessIndex(TABLE as ProcRow[], null, 'footprint')
    const ptys = [
      { ptyId: 'p1', worktreeId: 'repo-1::/w/feature', sessionId: 's1', paneKey: null, pid: 300 }
    ]
    const snapshot = await forkAugmentMemorySnapshot(upstreamSnapshot(), index, ptys, store, deps)
    const truth = snapshot.forkTruth!
    expect(truth.app).toEqual({
      total: 450 * MB,
      electron: 400 * MB,
      helpers: 0,
      terminalHost: 50 * MB
    })
    expect(truth.workspaces).toHaveLength(1)
    const [workspace] = truth.workspaces
    expect(workspace.worktreeName).toBe('feature')
    expect(workspace.memory).toBe(1205 * MB)
    expect(workspace.sessions.map((s) => [s.kind, s.memory, s.orphanCount])).toEqual([
      ['chat', 1000 * MB, 0],
      ['terminal', 205 * MB, 1]
    ])
    expect(truth.grandTotal).toBe(1655 * MB)
    expect(snapshot.totalMemory).toBe(truth.grandTotal)
    // Upstream's own row grows to its whole tree.
    expect(snapshot.worktrees[0].sessions[0].memory).toBe(205 * MB)
    expect(snapshot.app.memory).toBe(450 * MB)
  })

  it('uses PSS on Linux for every pid it accounts for', async () => {
    const index = buildProcessIndex(TABLE as ProcRow[], null, 'rss')
    const asked: number[] = []
    const snapshot = await forkAugmentMemorySnapshot(upstreamSnapshot(), index, [], store, {
      ...deps,
      linuxPss: true,
      readPss: async (pids) => {
        asked.push(...pids)
        return new Map([...asked].map((pid) => [pid, MB]))
      }
    })
    expect(snapshot.forkTruth?.metric).toBe('pss')
    expect(new Set(asked)).toEqual(new Set([400, 401, APP, 101, DAEMON, 300]))
    expect(snapshot.forkTruth?.grandTotal).toBe(6 * MB)
  })
})

describe('chatRootsFromRecords', () => {
  const record = (over: Partial<ForkChatRecordView> = {}): ForkChatRecordView => ({
    sessionId: 'c',
    provider: 'codex',
    location: {
      executionHostId: 'local',
      wslDistro: null,
      workspaceId: 'w',
      workspaceKind: 'git-worktree'
    },
    lease: { claimStatus: 'live', ownerProcess: { hostId: 'h', pid: 42 } },
    ...over
  })

  it('keeps live local chats and skips what this host cannot measure', () => {
    expect(chatRootsFromRecords([record()], 'h')).toHaveLength(1)
    expect(
      chatRootsFromRecords(
        [record({ lease: { claimStatus: 'released', ownerProcess: { hostId: 'h', pid: 42 } } })],
        'h'
      )
    ).toEqual([])
    expect(
      chatRootsFromRecords(
        [record({ lease: { claimStatus: 'reserved', ownerProcess: null } })],
        'h'
      )
    ).toEqual([])
    expect(
      chatRootsFromRecords(
        [record({ location: { ...record().location, wslDistro: 'Ubuntu' } })],
        'h'
      )
    ).toEqual([])
    expect(
      chatRootsFromRecords(
        [record({ location: { ...record().location, executionHostId: 'ssh:box' } })],
        'h'
      )
    ).toEqual([])
    expect(chatRootsFromRecords([record()], 'other-host')).toEqual([])
  })

  it('maps folder workspaces to the id terminals use', () => {
    expect(
      chatWorkspaceKey({
        executionHostId: 'local',
        wslDistro: null,
        workspaceId: 'f1',
        workspaceKind: 'folder'
      })
    ).toBe('folder:f1')
    expect(
      chatWorkspaceKey({
        executionHostId: 'local',
        wslDistro: null,
        workspaceId: 'r::/p',
        workspaceKind: 'git-worktree'
      })
    ).toBe('r::/p')
  })
})
