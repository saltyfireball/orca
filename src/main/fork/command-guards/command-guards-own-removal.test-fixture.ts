// BAD-892 test fixture: a real temporary git repo with linked worktrees, and a host whose bots are
// made-up names. Only Orca's own store (who owns what) is stood in; git is real.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OwnRemovalHost, OwnRemovalPsRow } from './command-guards-own-removal'

export function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=t@example.test',
      '-c',
      'commit.gpgsign=false',
      ...args
    ],
    { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } }
  )
}

export type TestRepo = { main: string; worktrees: string }

/** A repo whose default branch is main, with one commit. */
export function makeTestRepo(): TestRepo {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'guard-own-removal-')))
  const main = join(base, 'repo')
  mkdirSync(main)
  git(main, 'init', '-q', '-b', 'main')
  writeFileSync(join(main, 'file.txt'), 'one\n')
  git(main, 'add', '.')
  git(main, 'commit', '-q', '-m', 'first')
  return { main, worktrees: join(base, 'worktrees') }
}

/** A linked worktree on a new branch, one commit ahead of main. */
export function addTestWorktree(
  repo: TestRepo,
  name: string
): { id: string; path: string; branch: string } {
  mkdirSync(repo.worktrees, { recursive: true })
  const path = join(repo.worktrees, name)
  git(repo.main, 'worktree', 'add', '-q', '-b', name, path)
  writeFileSync(join(path, `${name}.txt`), 'work\n')
  git(path, 'add', '.')
  git(path, 'commit', '-q', '-m', `work ${name}`)
  return { id: `repo1::${path}`, path, branch: name }
}

/** Fast-forwards main to the branch, as a landed PR does. */
export function mergeIntoMain(repo: TestRepo, branch: string): void {
  git(repo.main, 'merge', '-q', '--ff-only', branch)
}

export type TestOwnership = {
  /** worktree id -> the bot name `worktree ps` shows for it */
  psBot?: Record<string, string>
  /** worktree id -> number of open agents */
  agents?: Record<string, number>
  /** worktree id -> bot id the chat index knows (a worker the bot started) */
  workerOf?: Record<string, string>
  /** pane key -> bot id */
  paneOf?: Record<string, string>
}

export const TEST_BOTS = [
  { id: 'bot-pixie', name: 'Pixie' },
  { id: 'bot-gizmo', name: 'Gizmo' }
]

/** Stands in for Orca's bot and agent state; resolves selectors against the real repo's worktrees. */
export function makeOwnershipRuntime(
  repo: TestRepo,
  state: TestOwnership
): {
  host: OwnRemovalHost
  runtime: {
    showManagedWorktree: OwnRemovalHost['resolveWorktree']
    getWorktreePs: (
      limit?: number,
      supported?: boolean,
      wait?: boolean,
      worktreeId?: string
    ) => Promise<{ worktrees: OwnRemovalPsRow[] }>
    botChatTreeIndex: {
      botOfPane: (paneKey: string) => string | null
      botOfSession: (sessionId: string) => string | null
      botOfWorktree: (worktreeId: string) => string | null
    }
  }
} {
  const resolveWorktree: OwnRemovalHost['resolveWorktree'] = async (selector) => {
    const wanted = selector.replace(/^(id|path):/, '')
    const listed = git(repo.main, 'worktree', 'list', '--porcelain')
      .split('\n\n')
      .map((block) => {
        const path = /^worktree (.+)$/m.exec(block)?.[1] ?? ''
        const branch = /^branch (.+)$/m.exec(block)?.[1] ?? ''
        return { id: `repo1::${path}`, path, branch, isMainWorktree: path === repo.main }
      })
    const found = listed.find((entry) => entry.id === wanted || entry.path === wanted)
    if (!found) {
      throw new Error('selector_not_found')
    }
    return found
  }
  const psRows = async (worktreeId?: string): Promise<OwnRemovalPsRow[]> => {
    const ids = new Set([...Object.keys(state.psBot ?? {}), ...Object.keys(state.agents ?? {})])
    return [...ids]
      .filter((id) => worktreeId === undefined || id === worktreeId)
      .map((id) => ({
        worktreeId: id,
        ...(state.psBot?.[id] ? { bot: state.psBot[id] } : {}),
        agents: Array.from({ length: state.agents?.[id] ?? 0 }, () => ({}))
      }))
  }
  const botChatTreeIndex = {
    botOfPane: (paneKey: string) => state.paneOf?.[paneKey] ?? null,
    botOfSession: () => null,
    botOfWorktree: (worktreeId: string) => state.workerOf?.[worktreeId] ?? null
  }
  return {
    host: {
      bots: () => TEST_BOTS,
      botIdOfPane: botChatTreeIndex.botOfPane,
      botIdOfSession: botChatTreeIndex.botOfSession,
      botIdOfWorktree: botChatTreeIndex.botOfWorktree,
      resolveWorktree,
      psRows: (worktreeId) => psRows(worktreeId)
    },
    runtime: {
      showManagedWorktree: resolveWorktree,
      getWorktreePs: async (_limit, _supported, _wait, worktreeId) => ({
        worktrees: await psRows(worktreeId)
      }),
      botChatTreeIndex
    }
  }
}
