import { describe, expect, it, vi } from 'vitest'
import {
  runWorktreeMove,
  WorktreeMoveStepError,
  type WorktreeMoveRunArgs
} from './worktree-move-runner'
import { resolveWorktreeMoveSettings, WORKTREE_MOVE_DEFAULTS } from './worktree-move-settings'
import type { WorktreeMoveInspectResult } from './worktree-move-wire'

const inspect: WorktreeMoveInspectResult = {
  worktreeId: 'repo-src::/home/alice/work/repo',
  displayName: 'repo',
  path: '/home/alice/work/repo',
  branch: 'feature',
  head: 'abc123',
  repoId: 'repo-src',
  projectId: 'proj-1',
  remote: 'origin',
  upstream: 'origin/feature',
  dirty: true,
  home: '/home/alice',
  comment: 'notes',
  wsl: false,
  chats: [
    {
      sessionId: 'claude-s1',
      agent: 'claude',
      providerSessionId: 'prov-1',
      name: 'Chat one',
      busy: false,
      transcriptBytes: 10
    }
  ]
}

type Call = { side: string; method: string; params: Record<string, unknown> }

function fakeHosts(overrides: Record<string, unknown> = {}) {
  const calls: Call[] = []
  const replies: Record<string, unknown> = {
    'fork.worktreeMove.inspect': inspect,
    'projectHostSetup.list': {
      setups: [{ projectId: 'proj-1', hostId: 'local', repoId: 'repo-dst', setupState: 'ready' }]
    },
    'fork.worktreeMove.export': {
      head: 'abc123',
      patch: 'cGF0Y2g=',
      patchBytes: 5,
      transcripts: [
        {
          sessionId: 'claude-s1',
          agent: 'claude',
          providerSessionId: 'prov-1',
          name: 'prov-1.jsonl',
          relPath: 'prov-1.jsonl',
          content: 'e30='
        }
      ],
      skipped: [],
      stopped: []
    },
    'git.push': {},
    'worktree.create': {
      worktree: {
        id: 'repo-dst::/srv/repo',
        git: { path: '/srv/repo', branch: 'refs/heads/feature' }
      }
    },
    'fork.worktreeMove.import': {
      patch: { kind: 'applied' },
      transcripts: [
        { sessionId: 'claude-s1', providerSessionId: 'prov-1', agent: 'claude', written: true }
      ]
    },
    'agentSession.create': { ok: true },
    'worktree.set': {},
    ...overrides
  }
  const call: WorktreeMoveRunArgs['call'] = async (side, method, params) => {
    calls.push({ side, method, params })
    const reply = replies[method]
    if (reply instanceof Error) {
      throw reply
    }
    return reply
  }
  return { calls, call }
}

function args(call: WorktreeMoveRunArgs['call'], extra: Partial<WorktreeMoveRunArgs> = {}) {
  let n = 0
  return {
    call,
    worktree: 'path:/home/alice/work/repo',
    sourceHostId: 'local',
    targetHostId: 'runtime:env-test',
    targetLabel: 'test-server',
    settings: WORKTREE_MOVE_DEFAULTS,
    stopTurns: false,
    randomUuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    now: () => new Date('2026-01-02T03:04:05Z'),
    ...extra
  }
}

describe('runWorktreeMove', () => {
  it('runs each step on the host that owns it, in order', async () => {
    const hosts = fakeHosts()
    const result = await runWorktreeMove(args(hosts.call))
    expect(hosts.calls.map((c) => `${c.side} ${c.method}`)).toEqual([
      'source fork.worktreeMove.inspect',
      'target projectHostSetup.list',
      'source fork.worktreeMove.export',
      'source git.push',
      'target worktree.create',
      'target fork.worktreeMove.import',
      'target agentSession.create',
      'source worktree.set'
    ])
    expect(result).toMatchObject({
      kind: 'moved',
      target: { worktreeId: 'repo-dst::/srv/repo', path: '/srv/repo' },
      pushed: true,
      patch: { kind: 'applied' },
      marked: true
    })
    const create = hosts.calls.find((c) => c.method === 'worktree.create')?.params
    expect(create).toMatchObject({
      repo: 'id:repo-dst',
      baseBranch: 'origin/feature',
      branchNameOverride: 'feature',
      branchIntent: 'open-existing-v2'
    })
    const reopen = hosts.calls.find((c) => c.method === 'agentSession.create')?.params
    expect(reopen).toMatchObject({
      worktree: 'id:repo-dst::/srv/repo',
      resumeFrom: { providerSessionId: 'prov-1' }
    })
    const mark = hosts.calls.find((c) => c.method === 'worktree.set')?.params
    expect(String(mark?.comment)).toContain('[moved to test-server')
    expect(hosts.calls.some((c) => /remove|delete/i.test(c.method))).toBe(false)
  })

  it('stops after the target check on a dry run', async () => {
    const hosts = fakeHosts()
    const result = await runWorktreeMove(args(hosts.call, { dryRun: true }))
    expect(result.kind).toBe('dry-run')
    expect(hosts.calls.map((c) => c.method)).toEqual([
      'fork.worktreeMove.inspect',
      'projectHostSetup.list'
    ])
  })

  it('returns ask without touching anything when a chat is mid-turn', async () => {
    const busy = { ...inspect, chats: [{ ...inspect.chats[0], busy: true }] }
    const hosts = fakeHosts({ 'fork.worktreeMove.inspect': busy })
    const result = await runWorktreeMove(args(hosts.call))
    expect(result.kind).toBe('ask')
    expect(hosts.calls).toHaveLength(1)
  })

  it('reports a refused chat reopen per chat and still marks the source', async () => {
    const hosts = fakeHosts({ 'agentSession.create': { ok: false, refusal: { message: 'no' } } })
    const result = await runWorktreeMove(args(hosts.call))
    expect(result.kind === 'moved' && result.chats).toEqual([
      { sessionId: 'claude-s1', name: 'Chat one', targetSessionId: null, reason: 'no' }
    ])
  })

  it('names the failed step and what ran before it', async () => {
    const hosts = fakeHosts({ 'worktree.create': new Error('branch missing') })
    const onStep = vi.fn()
    const error = await runWorktreeMove(args(hosts.call, { onStep })).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(WorktreeMoveStepError)
    expect((error as WorktreeMoveStepError).step).toBe('create')
    expect((error as Error).message).toMatch(/pushed feature/)
    expect(hosts.calls.some((c) => c.method === 'worktree.set')).toBe(false)
  })

  it('skips push and the mark when they are off', async () => {
    const hosts = fakeHosts()
    const settings = resolveWorktreeMoveSettings({ push: false, markSource: false })
    const result = await runWorktreeMove(args(hosts.call, { settings }))
    expect(hosts.calls.map((c) => c.method)).not.toContain('git.push')
    expect(hosts.calls.map((c) => c.method)).not.toContain('worktree.set')
    expect(result).toMatchObject({ kind: 'moved', pushed: false, marked: false })
  })
})
