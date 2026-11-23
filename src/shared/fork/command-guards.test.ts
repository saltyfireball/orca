import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  COMMAND_GUARD_SURFACES,
  COMMAND_GUARD_SURFACE_PROOFS,
  commandGuardCoverage,
  commandGuardSurfaceCoverage,
  readCommandGuardConfig
} from './command-guards'
import {
  evaluateCommandGuard,
  type CommandGuardContext,
  type CommandGuardGit
} from './command-guards-rules'

const ROOT = '/work/repo-a'

function context(git: CommandGuardGit, overrides: Partial<CommandGuardContext> = {}) {
  const ctx: CommandGuardContext = {
    workspaceRoot: ROOT,
    home: '/home/dev',
    deleteRoots: ['/tmp', '/private/tmp'],
    protectedBranches: [],
    gitState: () => git,
    off: new Set(),
    ...overrides
  }
  return ctx
}

const onMain: CommandGuardGit = { current: 'main', defaultBranch: 'main' }
const onFeature: CommandGuardGit = { current: 'feature/x', defaultBranch: 'main' }

function rule(command: string, git: CommandGuardGit = onFeature): string {
  const verdict = evaluateCommandGuard(command, context(git))
  return verdict.allowed ? 'allow' : verdict.rule
}

describe('delete-outside-workspace', () => {
  it.each([
    ['rm -rf ..', 'delete-outside-workspace'],
    ['rm -rf ../other', 'delete-outside-workspace'],
    ['rm -rf /', 'delete-outside-workspace'],
    ['rm -rf /*', 'delete-outside-workspace'],
    ['rm -rf ~', 'delete-outside-workspace'],
    ['rm -rf ~/Documents', 'delete-outside-workspace'],
    ['rm -rf $HOME/x', 'delete-outside-workspace'],
    ['rm -rf "$SOME_DIR"', 'delete-outside-workspace'],
    ['rm -rf /work/repo-b', 'delete-outside-workspace'],
    ['rm -rf /work/repo-a/../repo-b', 'delete-outside-workspace'],
    ['rm -rf /work/repo-a-copy', 'delete-outside-workspace'],
    ['cd .. && rm -rf build', 'delete-outside-workspace'],
    ['cd /etc && rm x', 'delete-outside-workspace'],
    ['echo hi; sudo rm -rf /var/lib/x', 'delete-outside-workspace'],
    ['env FOO=1 rm -rf ../x', 'delete-outside-workspace'],
    ['/bin/rm -rf ../x', 'delete-outside-workspace'],
    ['bash -c "rm -rf ../x"', 'delete-outside-workspace'],
    ["sh -lc 'rm -rf /opt/x'", 'delete-outside-workspace'],
    ['eval "rm -rf ../x"', 'delete-outside-workspace'],
    ['echo "$(rm -rf ../x)"', 'delete-outside-workspace'],
    ['ls | xargs rm -f', 'delete-outside-workspace'],
    ['find .. -name x -delete', 'delete-outside-workspace'],
    ['find / -type f -exec rm {} ;', 'delete-outside-workspace'],
    ['rm -rf -- ../x', 'delete-outside-workspace'],
    ['rmdir ../x', 'delete-outside-workspace'],
    ['rm -rf "unterminated', 'unreadable-command'],
    ['rm -rf build', 'allow'],
    ['rm -rf ./dist node_modules', 'allow'],
    ['rm -rf /work/repo-a/dist', 'allow'],
    ['rm -rf /tmp/scratch', 'allow'],
    ['rm -f $PWD/a.txt', 'allow'],
    ['cd src && rm -rf ../dist', 'allow'],
    ['rm -rf *.o', 'allow'],
    ['find . -name "*.log" -delete', 'allow'],
    ['find .. -name x -print', 'allow'],
    ['find ../other -exec grep foo {} +', 'allow'],
    ['ls ..', 'allow'],
    ['echo rm -rf ..', 'allow'],
    ['grep -r "rm -rf" .', 'allow']
  ])('%s -> %s', (command, expected) => {
    expect(rule(command)).toBe(expected)
  })
})

describe('force-push', () => {
  it.each([
    ['git push --force', 'force-push'],
    ['git push -f origin main', 'force-push'],
    ['git push --force-with-lease origin feature', 'force-push'],
    ['git push origin +feature', 'force-push'],
    ['git push --mirror', 'force-push'],
    ['git -C ../x push -f', 'force-push'],
    ['git -c core.editor=true push --force', 'force-push'],
    ['cd sub && git push -fu origin x', 'force-push'],
    ['git push', 'allow'],
    ['git push -u origin feature', 'allow'],
    ['git push origin HEAD:refs/heads/feature', 'allow'],
    ['git pull --force', 'allow'],
    ['git push origin :main', 'default-branch-rewrite'],
    ['git push --delete origin main', 'default-branch-rewrite'],
    ['git push origin --delete old-branch', 'allow']
  ])('%s -> %s', (command, expected) => {
    expect(rule(command)).toBe(expected)
  })
})

describe('default-branch-rewrite', () => {
  it.each([
    ['git reset --hard', onMain, 'default-branch-rewrite'],
    ['git reset --hard origin/main', onMain, 'default-branch-rewrite'],
    ['git rebase origin/main', onMain, 'default-branch-rewrite'],
    ['git commit --amend --no-edit', onMain, 'default-branch-rewrite'],
    ['git reset --soft HEAD~1', onMain, 'allow'],
    ['git reset --hard', onFeature, 'allow'],
    ['git rebase main', onFeature, 'allow'],
    ['git reset --hard', { current: null, defaultBranch: null }, 'allow'],
    ['git branch -D main', onFeature, 'default-branch-rewrite'],
    ['git branch -f main HEAD~3', onFeature, 'default-branch-rewrite'],
    ['git branch -D old-branch', onFeature, 'allow'],
    ['git checkout -B main origin/main', onFeature, 'default-branch-rewrite'],
    ['git switch -C main', onFeature, 'default-branch-rewrite'],
    ['git update-ref refs/heads/main abc123', onFeature, 'default-branch-rewrite'],
    ['git filter-branch --env-filter true', onFeature, 'default-branch-rewrite'],
    ['git filter-repo --path x', onFeature, 'default-branch-rewrite'],
    ['git status && git log', onMain, 'allow']
  ])('%s -> %s', (command, git, expected) => {
    expect(rule(command, git)).toBe(expected)
  })

  it('protects the default branch the repo names, and a configured list', () => {
    const trunk = { current: 'trunk', defaultBranch: 'trunk' }
    expect(rule('git reset --hard', trunk)).toBe('default-branch-rewrite')
    expect(rule('git reset --hard', { current: 'main', defaultBranch: 'trunk' })).toBe('allow')
    const custom = context(
      { current: 'release', defaultBranch: 'main' },
      { protectedBranches: ['release'] }
    )
    expect(evaluateCommandGuard('git reset --hard', custom).allowed).toBe(false)
  })
})

describe('remove-worktree and guard-config', () => {
  it.each([
    ['git worktree remove ../other', 'remove-worktree'],
    ['git worktree remove --force ../other', 'remove-worktree'],
    ['git worktree list', 'allow'],
    ['git worktree add ../x', 'allow'],
    ['orca worktree rm --worktree id:abc', 'remove-worktree'],
    ['orca worktree delete --worktree id:abc', 'remove-worktree'],
    ['orca worktree list', 'allow'],
    // BAD-764: a lone help flag prints usage and removes nothing.
    ['orca worktree rm --help', 'allow'],
    ['orca worktree remove -h', 'allow'],
    ['orca worktree delete --help', 'allow'],
    ['git worktree remove --help', 'allow'],
    ['git -C ../other worktree remove -h', 'allow'],
    ['orca worktree rm x --help', 'remove-worktree'],
    ['orca worktree rm --worktree id:abc --help', 'remove-worktree'],
    ['orca worktree rm --help --force', 'remove-worktree'],
    ['git worktree remove ../other --help', 'remove-worktree'],
    ['git worktree remove --help ../other', 'remove-worktree'],
    ['git worktree remove --force --help', 'remove-worktree'],
    ['rm ../x --help', 'delete-outside-workspace'],
    ['orca settings set forkCommandGuards false', 'guard-config'],
    ['orca settings set forkCommandGuardDisabledRules force-push', 'guard-config'],
    ['orca settings set forkDigest true', 'allow'],
    ['orca command-guards allow force-push', 'guard-config'],
    ['orca command-guards list', 'allow']
  ])('%s -> %s', (command, expected) => {
    expect(rule(command)).toBe(expected)
  })
})

describe('allow overrides', () => {
  it('lets a rule that is off through and keeps the others', () => {
    const ctx = context(onFeature, { off: new Set(['force-push']) })
    expect(evaluateCommandGuard('git push --force', ctx).allowed).toBe(true)
    expect(evaluateCommandGuard('git push -f && rm -rf ..', ctx)).toMatchObject({
      allowed: false,
      rule: 'delete-outside-workspace'
    })
  })

  it('lets extra delete roots through', () => {
    const ctx = context(onFeature, { deleteRoots: ['/tmp', '/srv/cache'] })
    expect(evaluateCommandGuard('rm -rf /srv/cache/x', ctx).allowed).toBe(true)
    expect(evaluateCommandGuard('rm -rf /srv/other', ctx).allowed).toBe(false)
  })
})

describe('settings and coverage', () => {
  it('reads the defaults and per-project allows', () => {
    const config = readCommandGuardConfig({
      forkCommandGuardDisabledRules: 'force-push, bogus',
      forkCommandGuardProjectRules: { repo1: 'remove-worktree,guard-config' },
      forkCommandGuardAuditLimit: 50
    })
    expect(config.enabled).toBe(true)
    expect([...config.disabled]).toEqual(['force-push'])
    expect([...(config.projectAllowed.repo1 ?? [])]).toEqual(['remove-worktree', 'guard-config'])
    expect(config.auditLimit).toBe(50)
    expect(readCommandGuardConfig({ forkCommandGuards: false }).enabled).toBe(false)
    expect(readCommandGuardConfig(null).auditLimit).toBe(200)
  })

  it('lists the other agents as unguarded and Claude as guarded only where proven', () => {
    const none = { terminal: null, 'native-chat': null, 'chat-worker': null }
    expect(commandGuardCoverage(none).some((row) => row.guarded)).toBe(false)
    expect(commandGuardSurfaceCoverage(none).some((row) => row.guarded)).toBe(false)
    const coverage = commandGuardCoverage()
    expect(coverage.find((row) => row.agent === 'codex')?.guarded).toBe(false)
    expect(coverage.find((row) => row.agent === 'claude')?.guarded).toBe(
      COMMAND_GUARD_SURFACES.every((surface) => COMMAND_GUARD_SURFACE_PROOFS[surface] !== null)
    )
  })

  it('names, for every guarded surface, a test file that proves a deny', () => {
    for (const row of commandGuardSurfaceCoverage().filter((surface) => surface.guarded)) {
      const text = readFileSync(join(__dirname, '../../..', row.proof ?? 'missing'), 'utf8')
      expect(text).toContain(`command guard proof: ${row.surface.replace('-', ' ')}`)
      expect(text).toContain("permissionDecision).toBe('deny')")
    }
  })
})
