// BAD-677 (FORK.md "Worktree snapshots"): the git work. A snapshot is a commit of the whole working
// tree (tracked changes and untracked files, never ignored ones) built through a temporary index,
// so the worktree's own index is not touched, stored under refs/orca/snapshots/<workspace>/<ms>.
// refs/orca is no default push or fetch refspec, so snapshots stay on this host. Every call goes
// through an injected runner: the app uses its admitted git runner, tests use throwaway repos.
import { rm } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
import {
  FORK_WORKTREE_SNAPSHOT_REF_PREFIX,
  type ForkWorktreeSnapshot
} from '../../../shared/fork/worktree-snapshots'
import {
  countDirtyFiles,
  countUnpushedCommits,
  resolveLostWorkBase,
  tryGit
} from '../lost-work/lost-work-git'

export type SnapshotGitOptions = { cwd: string; env?: Record<string, string>; stdin?: string }
/** Runs git and resolves its stdout; rejects on a non-zero exit. */
export type SnapshotGit = (args: string[], options: SnapshotGitOptions) => Promise<string>

const DAY_MS = 86_400_000
const AUTHOR_ENV = {
  GIT_AUTHOR_NAME: 'Orca snapshot',
  GIT_AUTHOR_EMAIL: 'snapshot@orca.invalid',
  GIT_COMMITTER_NAME: 'Orca snapshot',
  GIT_COMMITTER_EMAIL: 'snapshot@orca.invalid'
}

type SnapshotMeta = {
  path: string
  branch: string | null
  head: string | null
  createdAt: number
  files: number
}

/** A ref-safe folder name for a worktree path. */
export function snapshotWorkspaceName(worktreePath: string): string {
  const name = basename(worktreePath.replace(/[\\/]+$/, ''))
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .replace(/\.lock$/, '')
  return name.length > 0 ? name.slice(0, 100) : 'workspace'
}

async function currentBranch(git: SnapshotGit, cwd: string): Promise<string | null> {
  const out = await tryGit(git, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd })
  return out?.trim() || null
}

async function currentHead(git: SnapshotGit, cwd: string): Promise<string | null> {
  const out = await tryGit(git, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], { cwd })
  return out?.trim() || null
}

/** True when removing the worktree would lose work: changes on disk, or commits no remote has. */
export async function worktreeHoldsWork(git: SnapshotGit, cwd: string): Promise<boolean> {
  const dirty = await countDirtyFiles(git, cwd)
  if (dirty === null || dirty > 0) {
    return true
  }
  const head = await currentHead(git, cwd)
  if (!head) {
    return false
  }
  const base = await resolveLostWorkBase(git, cwd, undefined)
  const unpushed = await countUnpushedCommits(git, cwd, base?.ref ?? null, 'HEAD')
  return unpushed === null || unpushed > 0
}

async function newSnapshotRef(git: SnapshotGit, cwd: string, workspace: string, now: number) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const stamp = attempt === 0 ? String(now) : `${now}-${attempt}`
    const ref = `${FORK_WORKTREE_SNAPSHOT_REF_PREFIX}${workspace}/${stamp}`
    const taken = await tryGit(git, ['rev-parse', '--verify', '--quiet', ref], { cwd })
    if (!taken?.trim()) {
      return { ref, id: `${workspace}/${stamp}` }
    }
  }
  throw new Error('Could not pick a free snapshot name.')
}

export type CreatedSnapshot = { id: string; ref: string; commit: string; files: number }

/**
 * Snapshots the worktree at `worktreePath` when it holds work. Null when it holds none (clean and
 * fully pushed or merged). Throws when it needed a snapshot and could not write it.
 */
export async function createWorktreeSnapshot(
  git: SnapshotGit,
  worktreePath: string,
  now: number
): Promise<CreatedSnapshot | null> {
  if (!(await worktreeHoldsWork(git, worktreePath))) {
    return null
  }
  const head = await currentHead(git, worktreePath)
  const branch = await currentBranch(git, worktreePath)
  const files = (await countDirtyFiles(git, worktreePath)) ?? 0
  const indexName = (
    await git(['rev-parse', '--git-path', `orca-snapshot-index-${process.pid}-${now}`], {
      cwd: worktreePath
    })
  ).trim()
  const indexPath = isAbsolute(indexName) ? indexName : join(worktreePath, indexName)
  const env = { GIT_INDEX_FILE: indexPath, ...AUTHOR_ENV }
  try {
    if (head) {
      await git(['read-tree', 'HEAD'], { cwd: worktreePath, env })
    }
    await git(['add', '-A', '--', '.'], { cwd: worktreePath, env })
    const tree = (await git(['write-tree'], { cwd: worktreePath, env })).trim()
    const workspace = snapshotWorkspaceName(worktreePath)
    const meta: SnapshotMeta = { path: worktreePath, branch, head, createdAt: now, files }
    const message = `orca snapshot: ${workspace}\n\n${JSON.stringify(meta)}\n`
    const commit = (
      await git(
        [
          '-c',
          'commit.gpgsign=false',
          'commit-tree',
          tree,
          ...(head ? ['-p', head] : []),
          '-F',
          '-'
        ],
        { cwd: worktreePath, env, stdin: message }
      )
    ).trim()
    const { ref, id } = await newSnapshotRef(git, worktreePath, workspace, now)
    await git(['update-ref', ref, commit], { cwd: worktreePath })
    return { id, ref, commit, files }
  } finally {
    await rm(indexPath, { force: true }).catch(() => undefined)
  }
}

function parseMeta(body: string): SnapshotMeta | null {
  try {
    const value: unknown = JSON.parse(body.trim().split('\n').pop() ?? '')
    if (typeof value !== 'object' || value === null) {
      return null
    }
    const meta = value as Partial<SnapshotMeta>
    if (typeof meta.path !== 'string' || typeof meta.createdAt !== 'number') {
      return null
    }
    return {
      path: meta.path,
      branch: typeof meta.branch === 'string' ? meta.branch : null,
      head: typeof meta.head === 'string' ? meta.head : null,
      createdAt: meta.createdAt,
      files: typeof meta.files === 'number' ? meta.files : 0
    }
  } catch {
    return null
  }
}

/** Every snapshot in one repository; refs whose commit has no readable record are left out. */
export async function listWorktreeSnapshots(
  git: SnapshotGit,
  repo: { id: string; name: string; path: string },
  retentionDays: number
): Promise<ForkWorktreeSnapshot[]> {
  const out = await git(
    [
      'for-each-ref',
      '--format=%(refname)%1f%(objectname)%1f%(contents:body)%1e',
      FORK_WORKTREE_SNAPSHOT_REF_PREFIX
    ],
    { cwd: repo.path }
  )
  const snapshots: ForkWorktreeSnapshot[] = []
  for (const record of out.split('\x1e')) {
    const [refname, commit, body] = record.replace(/^\n/, '').split('\x1f')
    const meta = refname && commit && body ? parseMeta(body) : null
    if (!meta) {
      continue
    }
    const id = refname.slice(FORK_WORKTREE_SNAPSHOT_REF_PREFIX.length)
    snapshots.push({
      id,
      repoId: repo.id,
      repoName: repo.name,
      workspace: id.split('/')[0] ?? id,
      path: meta.path,
      branch: meta.branch,
      head: meta.head,
      commit,
      createdAt: meta.createdAt,
      expiresAt: meta.createdAt + retentionDays * DAY_MS,
      files: meta.files
    })
  }
  return snapshots.sort((a, b) => b.createdAt - a.createdAt)
}

/** Deletes the snapshots past their retention; returns how many. */
export async function pruneWorktreeSnapshots(
  git: SnapshotGit,
  repo: { id: string; name: string; path: string },
  retentionDays: number,
  now: number
): Promise<number> {
  const expired = (await listWorktreeSnapshots(git, repo, retentionDays)).filter(
    (snapshot) => snapshot.expiresAt <= now
  )
  for (const snapshot of expired) {
    await git(['update-ref', '-d', `${FORK_WORKTREE_SNAPSHOT_REF_PREFIX}${snapshot.id}`], {
      cwd: repo.path
    })
  }
  return expired.length
}

async function branchCheckedOutElsewhere(git: SnapshotGit, repoPath: string, branch: string) {
  const out = await git(['worktree', 'list', '--porcelain'], { cwd: repoPath })
  return out.split('\n').includes(`branch refs/heads/${branch}`)
}

/** The branch name to restore onto: the original when free, else a `-restored` sibling. */
async function pickRestoreBranch(
  git: SnapshotGit,
  repoPath: string,
  snapshot: ForkWorktreeSnapshot
): Promise<{ name: string; create: boolean } | null> {
  if (!snapshot.branch || !snapshot.head) {
    return null
  }
  const existing = (
    await tryGit(
      git,
      ['rev-parse', '--verify', '--quiet', `refs/heads/${snapshot.branch}^{commit}`],
      { cwd: repoPath }
    )
  )?.trim()
  if (!existing) {
    return { name: snapshot.branch, create: true }
  }
  if (
    existing === snapshot.head &&
    !(await branchCheckedOutElsewhere(git, repoPath, snapshot.branch))
  ) {
    return { name: snapshot.branch, create: false }
  }
  return { name: `${snapshot.branch}-restored-${snapshot.createdAt}`, create: true }
}

/**
 * Recreates the worktree from a snapshot: the working tree as it was (changes unstaged, untracked
 * files untracked), on its branch at the head it had. Refuses a path that already exists.
 */
export async function restoreWorktreeSnapshot(
  git: SnapshotGit,
  repoPath: string,
  snapshot: ForkWorktreeSnapshot,
  targetPath: string
): Promise<{ path: string; branch: string | null; note: string | null }> {
  await git(['worktree', 'add', '--detach', targetPath, snapshot.commit], { cwd: repoPath })
  try {
    const target = await pickRestoreBranch(git, repoPath, snapshot)
    if (target && snapshot.head) {
      if (target.create) {
        await git(['branch', target.name, snapshot.head], { cwd: repoPath })
      }
      await git(['symbolic-ref', 'HEAD', `refs/heads/${target.name}`], { cwd: targetPath })
    }
    if (snapshot.head) {
      // Mixed reset: the index and HEAD go back to the head, the files on disk stay as snapshotted.
      await git(['reset', '-q', snapshot.head], { cwd: targetPath })
    }
    const renamed = target && target.name !== snapshot.branch
    return {
      path: targetPath,
      branch: target?.name ?? null,
      note: renamed
        ? `Branch ${snapshot.branch} exists at another commit or is in use, so the worktree is on ${target.name}.`
        : null
    }
  } catch (error) {
    await git(['worktree', 'remove', '--force', targetPath], { cwd: repoPath }).catch(
      () => undefined
    )
    throw error
  }
}
