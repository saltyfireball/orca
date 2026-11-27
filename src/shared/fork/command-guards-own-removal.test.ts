// BAD-892: when a bot's agent may remove its own workspace, and which command lines can ask.
import { describe, expect, it } from 'vitest'
import {
  decideOwnWorktreeRemoval,
  type OwnWorktreeRemovalFacts
} from './command-guards-own-removal'
import { evaluateCommandGuard, type CommandGuardContext } from './command-guards-rules'

const ok: OwnWorktreeRemovalFacts = {
  callerBot: 'Pixie',
  target: { id: 'repo::/w/one', branch: 'feature-one' },
  targetBot: 'Pixie',
  callerInsideTarget: false,
  agentsRunning: 0,
  dirty: false,
  deleteBranch: false,
  branchMerged: null
}

const failed = (facts: Partial<OwnWorktreeRemovalFacts>): string | null => {
  const decision = decideOwnWorktreeRemoval({ ...ok, ...facts })
  return decision.allowed ? null : decision.failed
}

describe('decideOwnWorktreeRemoval', () => {
  it('allows an owned, idle, clean workspace and says why', () => {
    const decision = decideOwnWorktreeRemoval(ok)
    expect(decision).toMatchObject({ allowed: true, bot: 'Pixie' })
    expect(decision.reason).toContain('branch kept')
  })

  it('refuses another bot, no bot, and nobody as owner', () => {
    expect(failed({ targetBot: 'Gizmo' })).toBe('target-not-owned')
    expect(failed({ targetBot: null })).toBe('target-not-owned')
    expect(failed({ callerBot: null })).toBe('caller-has-no-bot')
    expect(failed({ callerBot: null, targetBot: null })).toBe('caller-has-no-bot')
  })

  it('refuses a target Orca could not resolve', () => {
    expect(failed({ target: null })).toBe('target-unresolved')
  })

  it('refuses when the caller runs inside the target, or an agent runs there', () => {
    expect(failed({ callerInsideTarget: true })).toBe('caller-inside-target')
    expect(failed({ agentsRunning: 1 })).toBe('agent-running')
    expect(failed({ agentsRunning: 3 })).toBe('agent-running')
  })

  it('refuses a dirty tree, and one whose status could not be read', () => {
    expect(failed({ dirty: true })).toBe('uncommitted-changes')
    expect(failed({ dirty: null })).toBe('uncommitted-changes')
  })

  it('checks the branch only with --delete-branch', () => {
    expect(failed({ deleteBranch: false, branchMerged: false })).toBeNull()
    expect(failed({ deleteBranch: true, branchMerged: false })).toBe('branch-not-merged')
    expect(failed({ deleteBranch: true, branchMerged: null })).toBe('branch-not-merged')
    expect(failed({ deleteBranch: true, branchMerged: true })).toBeNull()
  })
})

const ctx: CommandGuardContext = {
  workspaceRoot: '/w/one',
  home: '/home/pat',
  deleteRoots: [],
  protectedBranches: [],
  gitState: () => ({ current: 'feature-one', defaultBranch: 'main' }),
  off: new Set()
}

describe('orca worktree rm in the rule engine', () => {
  const verdict = (command: string) => evaluateCommandGuard(command, ctx)

  it('hands a plain removal to the host, whatever spelling of the verb', () => {
    for (const verb of ['rm', 'remove', 'delete']) {
      expect(verdict(`orca worktree ${verb} --worktree id:repo::/w/two --json`)).toMatchObject({
        allowed: false,
        rule: 'remove-worktree',
        ownRemoval: { selector: 'id:repo::/w/two', deleteBranch: false }
      })
    }
    expect(verdict('orca worktree rm --worktree=path:/w/two --delete-branch')).toMatchObject({
      ownRemoval: { selector: 'path:/w/two', deleteBranch: true }
    })
  })

  it('keeps force flags, hooks, hosts and extra arguments blocked outright', () => {
    for (const command of [
      'orca worktree rm --worktree id:x --force',
      'orca worktree rm --worktree id:x --run-hooks',
      'orca worktree rm --worktree id:x --allow-failed-archive-hook',
      'orca worktree rm --worktree id:x --environment other',
      'orca worktree rm --worktree id:x extra',
      'orca worktree rm',
      'orca worktree rm --worktree "$TARGET"',
      'orca worktree rm --worktree "$(pick)"',
      'orca worktree rm --worktree id:a --worktree id:b',
      'echo id:x | xargs orca worktree rm --worktree',
      'git worktree remove ../two',
      'rm -rf /w/two'
    ]) {
      const result = verdict(command)
      expect(result.allowed, command).toBe(false)
      expect('ownRemoval' in result && result.ownRemoval, command).toBeFalsy()
    }
  })

  it('does not let a removal hide a firm denial beside it, or two removals', () => {
    expect(
      verdict('orca worktree rm --worktree id:a && git push --force origin main')
    ).toMatchObject({ rule: 'force-push' })
    expect(verdict('orca worktree rm --worktree id:a; rm -rf /etc/x')).toMatchObject({
      rule: 'delete-outside-workspace'
    })
    const two = verdict('orca worktree rm --worktree id:a; orca worktree rm --worktree id:b')
    expect(two).toMatchObject({ allowed: false, rule: 'remove-worktree' })
    expect('ownRemoval' in two && two.ownRemoval).toBeFalsy()
  })

  it('still lets help through and still obeys a rule that is off', () => {
    expect(verdict('orca worktree rm --help')).toEqual({ allowed: true })
    expect(
      evaluateCommandGuard('orca worktree rm --force --worktree id:a', {
        ...ctx,
        off: new Set(['remove-worktree'])
      })
    ).toEqual({ allowed: true })
  })
})
