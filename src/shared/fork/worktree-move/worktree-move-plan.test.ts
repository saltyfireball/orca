import { describe, expect, it } from 'vitest'
import type { ProjectHostSetup } from '../../project-types'
import {
  pickWorktreeMoveTargetRepo,
  planWorktreeMove,
  type WorktreeMovePlanInput
} from './worktree-move-plan'
import { resolveWorktreeMoveSettings, WORKTREE_MOVE_DEFAULTS } from './worktree-move-settings'
import type { WorktreeMoveChat } from './worktree-move-wire'

function chat(overrides: Partial<WorktreeMoveChat> = {}): WorktreeMoveChat {
  return {
    sessionId: 'claude-1',
    agent: 'claude',
    providerSessionId: 'prov-1',
    name: 'Chat one',
    busy: false,
    transcriptBytes: 100,
    ...overrides
  }
}

function input(overrides: Partial<WorktreeMovePlanInput> = {}): WorktreeMovePlanInput {
  return {
    sourceHostId: 'local',
    targetHostId: 'runtime:env-test',
    facts: {
      branch: 'feature',
      remote: 'origin',
      dirty: false,
      chats: [],
      wsl: false,
      comment: ''
    },
    settings: WORKTREE_MOVE_DEFAULTS,
    stopTurns: false,
    ...overrides
  }
}

describe('planWorktreeMove', () => {
  it('plans a clean move with push, create and the moved mark', () => {
    const plan = planWorktreeMove(input())
    expect(plan).toMatchObject({
      kind: 'move',
      steps: ['export', 'push', 'create', 'mark-source'],
      branch: 'feature',
      remote: 'origin',
      carryPatch: false
    })
  })

  it('refuses the same host, ssh hosts, wsl, detached and remoteless workspaces', () => {
    expect(planWorktreeMove(input({ targetHostId: 'local' }))).toMatchObject({ code: 'same-host' })
    expect(planWorktreeMove(input({ targetHostId: 'ssh:box' }))).toMatchObject({ code: 'ssh-host' })
    const facts = input().facts
    expect(planWorktreeMove(input({ facts: { ...facts, wsl: true } }))).toMatchObject({
      code: 'wsl'
    })
    expect(planWorktreeMove(input({ facts: { ...facts, branch: null } }))).toMatchObject({
      code: 'detached'
    })
    expect(planWorktreeMove(input({ facts: { ...facts, remote: null } }))).toMatchObject({
      code: 'no-remote'
    })
  })

  it('carries uncommitted changes as a patch, or refuses or leaves them by setting', () => {
    const facts = { ...input().facts, dirty: true }
    const patch = planWorktreeMove(input({ facts }))
    expect(patch).toMatchObject({ kind: 'move', carryPatch: true })
    expect(patch.kind === 'move' && patch.steps).toContain('apply-patch')
    const refuse = resolveWorktreeMoveSettings({ uncommitted: 'refuse' })
    expect(planWorktreeMove(input({ facts, settings: refuse }))).toMatchObject({
      kind: 'refuse',
      code: 'uncommitted'
    })
    const leave = resolveWorktreeMoveSettings({ uncommitted: 'leave' })
    expect(planWorktreeMove(input({ facts, settings: leave }))).toMatchObject({
      kind: 'move',
      carryPatch: false,
      leftUncommitted: true
    })
  })

  it('asks before stopping a running turn, refuses when set, and stops when agreed', () => {
    const facts = { ...input().facts, chats: [chat({ busy: true })] }
    expect(planWorktreeMove(input({ facts }))).toMatchObject({ kind: 'ask', code: 'busy' })
    const refuse = resolveWorktreeMoveSettings({ whenBusy: 'refuse' })
    expect(planWorktreeMove(input({ facts, settings: refuse }))).toMatchObject({
      kind: 'refuse',
      code: 'busy'
    })
    const agreed = planWorktreeMove(input({ facts, stopTurns: true }))
    expect(agreed).toMatchObject({ kind: 'move', stopTurns: true })
    expect(agreed.kind === 'move' && agreed.steps[0]).toBe('stop-turns')
  })

  it('carries chats with transcripts and lists the ones that stay', () => {
    const facts = {
      ...input().facts,
      chats: [
        chat(),
        chat({ sessionId: 'x', agent: 'gemini', name: 'Other agent' }),
        chat({ sessionId: 'y', providerSessionId: null, name: 'Empty' }),
        chat({ sessionId: 'z', transcriptBytes: null, name: 'Missing' })
      ]
    }
    const plan = planWorktreeMove(input({ facts }))
    expect(plan.kind).toBe('move')
    if (plan.kind !== 'move') {
      return
    }
    expect(plan.chats.map((c) => c.sessionId)).toEqual(['claude-1'])
    expect(plan.skippedChats.map((s) => s.chat.sessionId)).toEqual(['x', 'y', 'z'])
    expect(plan.steps).toEqual(
      expect.arrayContaining(['copy-chats', 'reopen-chats', 'mark-source'])
    )
  })

  it('skips chats, push and the mark when they are turned off', () => {
    const settings = resolveWorktreeMoveSettings({ chats: false, push: false, markSource: false })
    const facts = { ...input().facts, chats: [chat({ busy: true })] }
    const plan = planWorktreeMove(input({ facts, settings }))
    expect(plan).toMatchObject({ kind: 'move', steps: ['export', 'create'], chats: [] })
    expect(plan.kind === 'move' && plan.warnings.join(' ')).toMatch(/Push is off/)
  })

  it('warns when the workspace was moved before', () => {
    const facts = { ...input().facts, comment: '[moved to box on 2026-01-01]' }
    const plan = planWorktreeMove(input({ facts }))
    expect(plan.kind === 'move' && plan.warnings.join(' ')).toMatch(/moved before/)
  })
})

describe('pickWorktreeMoveTargetRepo', () => {
  function setup(overrides: Partial<ProjectHostSetup>): ProjectHostSetup {
    return {
      id: 's',
      projectId: 'p1',
      hostId: 'local',
      repoId: 'r1',
      path: '/srv/repo',
      displayName: 'repo',
      setupState: 'ready',
      ...overrides
    } as ProjectHostSetup
  }

  it('prefers the target answering for itself, then the target by runtime id, then the repo id', () => {
    const facts = { projectId: 'p1', repoId: 'r-src' }
    expect(
      pickWorktreeMoveTargetRepo(
        [setup({ hostId: 'runtime:env-test', repoId: 'r2' }), setup({ repoId: 'r3' })],
        facts,
        'runtime:env-test'
      )
    ).toEqual({ repo: 'id:r3', repoHostId: 'local' })
    expect(
      pickWorktreeMoveTargetRepo(
        [setup({ hostId: 'runtime:env-test', repoId: 'r2' })],
        facts,
        'runtime:env-test'
      )
    ).toEqual({ repo: 'id:r2', repoHostId: 'runtime:env-test' })
    expect(
      pickWorktreeMoveTargetRepo(
        [setup({ projectId: 'other', repoId: 'r-src', hostId: 'runtime:env-test' })],
        facts,
        'runtime:env-test'
      )
    ).toEqual({ repo: 'id:r-src', repoHostId: 'runtime:env-test' })
  })

  it('ignores setups that are not ready and returns null when none fit', () => {
    expect(
      pickWorktreeMoveTargetRepo(
        [setup({ setupState: 'pending' as ProjectHostSetup['setupState'] })],
        { projectId: 'p1', repoId: 'r1' },
        'runtime:env-test'
      )
    ).toBeNull()
  })
})

describe('planWorktreeMove hardening', () => {
  it('refuses an unsafe branch or remote before anything else', () => {
    for (const facts of [
      { branch: '--upload-pack=x', remote: 'origin' },
      { branch: 'feature', remote: '-oProxyCommand=x' },
      { branch: 'feat ure', remote: 'origin' },
      { branch: 'a..b', remote: 'origin' }
    ]) {
      const base = input()
      expect(planWorktreeMove({ ...base, facts: { ...base.facts, ...facts } })).toMatchObject({
        kind: 'refuse',
        code: 'unsafe-ref'
      })
    }
  })

  it('keeps at most 50 chats and leaves the rest behind', () => {
    const chats = Array.from({ length: 52 }, (_, n) => chat({ sessionId: `claude-${n}` }))
    const base = input()
    const plan = planWorktreeMove({ ...base, facts: { ...base.facts, chats } })
    expect(plan.kind === 'move' && plan.chats).toHaveLength(50)
    expect(plan.kind === 'move' && plan.skippedChats).toHaveLength(2)
  })

  it('leaves a chat behind when the total would pass the byte budget', () => {
    const mb = 1024 * 1024
    const chats = [
      chat({ sessionId: 'a', transcriptBytes: 40 * mb }),
      chat({ sessionId: 'b', transcriptBytes: 40 * mb }),
      chat({ sessionId: 'c', transcriptBytes: 10 * mb })
    ]
    const base = input({ settings: { ...WORKTREE_MOVE_DEFAULTS, maxTotalMb: 60 } })
    const plan = planWorktreeMove({ ...base, facts: { ...base.facts, chats } })
    expect(plan.kind === 'move' && plan.chats.map((c) => c.sessionId)).toEqual(['a', 'c'])
    expect(plan.kind === 'move' && plan.skippedChats[0].reason).toContain('60 MB')
  })

  it('resolves the total budget setting with a 256 MB default', () => {
    expect(resolveWorktreeMoveSettings({}).maxTotalMb).toBe(256)
    expect(resolveWorktreeMoveSettings({ maxTotalMb: 10 }).maxTotalMb).toBe(10)
    expect(resolveWorktreeMoveSettings({ maxTotalMb: 0 }).maxTotalMb).toBe(256)
    expect(resolveWorktreeMoveSettings({ maxTotalMb: 99999 }).maxTotalMb).toBe(256)
  })
})
