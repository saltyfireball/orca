import { describe, expect, it } from 'vitest'
import {
  ForkBatchStartParams,
  ForkBatchStartResultSchema,
  describeForkBatchTask,
  forkBatchDisplayName,
  forkBatchLocalSetupRepo,
  forkBatchReadySetupHosts,
  forkBatchWorktreeName,
  foldForkBatchAnswer,
  readForkBatchStartSettings,
  readForkBatchStartSettingsFrom,
  settleForkBatchOutcome
} from './batch-start'

const label = (agent: string): string => agent.toUpperCase()

describe('batch start params', () => {
  it('needs a prompt, a model and a project for auto placement', () => {
    const base = { prompt: 'fix it', agents: ['claude'], placement: 'here', repo: 'id:r1' }
    expect(ForkBatchStartParams.safeParse(base).success).toBe(true)
    expect(ForkBatchStartParams.safeParse({ ...base, prompt: '   ' }).success).toBe(false)
    expect(ForkBatchStartParams.safeParse({ ...base, agents: [] }).success).toBe(false)
    expect(ForkBatchStartParams.safeParse({ ...base, agents: ['nope'] }).success).toBe(false)
    expect(ForkBatchStartParams.safeParse({ ...base, placement: 'auto' }).success).toBe(false)
    expect(
      ForkBatchStartParams.safeParse({ ...base, placement: 'auto', project: { id: 'p' } }).success
    ).toBe(true)
    const { repo: _repo, ...noTarget } = base
    expect(ForkBatchStartParams.safeParse(noTarget).success).toBe(false)
  })

  it('caps the number of models', () => {
    const agents = Array.from({ length: 7 }, () => 'claude')
    expect(
      ForkBatchStartParams.safeParse({ prompt: 'x', agents, placement: 'here', repo: 'r' }).success
    ).toBe(false)
  })
})

describe('batch start result schema', () => {
  it('accepts tasks and rejects unknown shapes', () => {
    const ok = {
      hostKey: 'local',
      hostLabel: 'studio',
      tasks: [
        { agent: 'claude', ok: true, worktreeId: 'w1', name: 'n', queuedPosition: 2 },
        { agent: 'codex', ok: false, error: 'boom' }
      ]
    }
    expect(ForkBatchStartResultSchema.parse(ok).tasks).toHaveLength(2)
    expect(
      ForkBatchStartResultSchema.safeParse({ ...ok, tasks: [{ agent: 'claude', ok: true }] })
        .success
    ).toBe(false)
  })
})

describe('names', () => {
  it('slugs the prompt, adds the agent and the tail', () => {
    expect(forkBatchWorktreeName('Fix the Login bug!', 'claude', 'ab12')).toBe(
      'fix-the-login-bug-claude-ab12'
    )
    expect(forkBatchWorktreeName('$$$', 'codex', 'ZZ')).toBe('task-codex-zz')
    const long = forkBatchWorktreeName('a '.repeat(80), 'claude', '01')
    expect(long.length).toBeLessThanOrEqual(32 + '-claude-01'.length)
    expect(long).not.toMatch(/--/)
  })

  it('takes the first non-empty line as the display name', () => {
    expect(forkBatchDisplayName('\n  First line  \nsecond')).toBe('First line')
    expect(forkBatchDisplayName('x'.repeat(100))).toHaveLength(60)
  })
})

describe('setups', () => {
  const setups = [
    { projectId: 'p1', hostId: 'local', setupState: 'ready', repoId: 'r1' },
    { projectId: 'p1', hostId: 'runtime:s1', setupState: 'ready', repoId: 'r9' },
    { projectId: 'p1', hostId: 'ssh:box', setupState: 'ready', repoId: 'r8' },
    { projectId: 'p2', hostId: 'local', setupState: 'not-set-up', repoId: 'r2' }
  ] as const
  const projects = [
    { id: 'p1', displayName: 'Orca' },
    { id: 'p2', displayName: 'Other' }
  ]

  it('finds the local repo by id, then by a unique name', () => {
    expect(forkBatchLocalSetupRepo(projects, setups, { id: 'p1' })).toBe('id:r1')
    expect(forkBatchLocalSetupRepo(projects, setups, { id: 'elsewhere', name: 'orca' })).toBe(
      'id:r1'
    )
    expect(forkBatchLocalSetupRepo(projects, setups, { id: 'p2' })).toBeNull()
    expect(forkBatchLocalSetupRepo(projects, setups, { id: 'zz' })).toBeNull()
  })

  it('lists the machines with a ready setup, skipping SSH hosts', () => {
    expect(forkBatchReadySetupHosts(setups, 'p1')).toEqual(['local', 'runtime:s1'])
    expect(forkBatchReadySetupHosts(setups, 'p2')).toEqual([])
  })
})

describe('outcome', () => {
  it('clears only when every model started, and retries the failed ones', () => {
    const all = settleForkBatchOutcome(
      { tasks: [{ agent: 'claude', ok: true, worktreeId: 'w', name: 'n' }] },
      label
    )
    expect(all).toEqual({ allStarted: true, retryAgents: [], errors: [] })
    const partial = settleForkBatchOutcome(
      {
        tasks: [
          { agent: 'claude', ok: true, worktreeId: 'w', name: 'n' },
          { agent: 'codex', ok: false, error: 'no' }
        ]
      },
      label
    )
    expect(partial).toEqual({ allStarted: false, retryAgents: ['codex'], errors: ['CODEX: no'] })
    expect(settleForkBatchOutcome({ tasks: [] }, label).allStarted).toBe(false)
  })

  it('describes a started task with its queue place', () => {
    expect(
      describeForkBatchTask(
        { agent: 'claude', ok: true, worktreeId: 'w', name: 'fix-claude-1', queuedPosition: 3 },
        'studio',
        label
      )
    ).toBe('CLAUDE on studio: fix-claude-1, queued #3')
  })
})

describe('settings', () => {
  it('defaults everything on', () => {
    expect(readForkBatchStartSettings(undefined)).toEqual({
      enabled: true,
      keepOpen: true,
      autoHost: true,
      setupMissing: false
    })
    expect(readForkBatchStartSettings({ forkBatchStart: false }).enabled).toBe(false)
  })

  it('sets servers up only when asked (SLRM-2406)', () => {
    expect(readForkBatchStartSettings({ forkBatchStartSetupMissing: true }).setupMissing).toBe(true)
    expect(readForkBatchStartSettingsFrom({ forkBatchStartSetupMissing: true }).setupMissing).toBe(
      true
    )
    expect(readForkBatchStartSettingsFrom({ forkBatchStartSetupMissing: 'yes' }).setupMissing).toBe(
      false
    )
  })
})

describe('setup note (SLRM-2406)', () => {
  it('leads the acknowledgement, even when nothing started', () => {
    const started = foldForkBatchAnswer(
      {
        hostKey: 'runtime:s1',
        hostLabel: 'alpha',
        setupNote: 'Set up on alpha: cloned into /x.',
        tasks: [{ agent: 'claude', ok: true, worktreeId: 'w', name: 'n' }]
      },
      label
    )
    expect(started.lines).toEqual(['Set up on alpha: cloned into /x.', 'CLAUDE on alpha: n'])
    const failed = foldForkBatchAnswer(
      {
        hostKey: 'runtime:s1',
        hostLabel: 'alpha',
        setupNote: 'Set up on alpha: cloned into /x.',
        tasks: [{ agent: 'claude', ok: false, error: 'no' }]
      },
      label
    )
    expect(failed.lines).toEqual(['Set up on alpha: cloned into /x.'])
    expect(failed.error).toBe('CLAUDE: no')
  })

  it('takes setupMissing in the params', () => {
    expect(
      ForkBatchStartParams.parse({
        project: { id: 'p' },
        prompt: 'x',
        agents: ['claude'],
        placement: 'auto',
        setupMissing: true
      }).setupMissing
    ).toBe(true)
  })
})
