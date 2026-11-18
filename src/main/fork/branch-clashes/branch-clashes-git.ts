// Branch clashes (FORK.md, SLRM-2394): the read-only git questions one host asks of its own
// worktrees. Committed facts are cached by head and base commit, so a check where nothing moved
// costs one `worktree list` and one base read per repository (plus `status` when uncommitted
// changes count). No fetch, no checkout, no hooks or diff drivers, no file contents.
import { mapWithConcurrency } from '../../../shared/concurrency/map-with-concurrency'
import { composeWorktreeId } from '../../../shared/worktree/id'
import type { GitWorktreeInfo } from '../../../shared/worktree/types'
import {
  FORK_CLASHES_MAX_FILES_PER_BRANCH,
  normalizeForkRemoteUrl,
  type ForkClashBranch,
  type ForkClashRepo
} from '../../../shared/fork/branch-clashes'
import {
  LOST_WORK_OID,
  resolveLostWorkBase,
  shortBranchName,
  tryGit,
  type LostWorkGit
} from '../lost-work/lost-work-git'

export type ClashRepo = { id: string; name: string; path: string; defaultBranch?: string }

export type ClashScanDeps = {
  git: LostWorkGit
  listWorktrees: (repo: ClashRepo, signal?: AbortSignal) => Promise<GitWorktreeInfo[]>
}

export type ClashScanOptions = { uncommitted: boolean; signal?: AbortSignal }

type CommittedFacts = { ahead: number; behind: number; files: string[] }

const WORKTREE_CONCURRENCY = 4
const CACHE_LIMIT = 2000

/** Committed facts by worktree path, head and base commit; oldest entries go first past the cap. */
export class ForkClashCache {
  private readonly entries = new Map<string, CommittedFacts>()

  get(key: string): CommittedFacts | undefined {
    const found = this.entries.get(key)
    if (found) {
      this.entries.delete(key)
      this.entries.set(key, found)
    }
    return found
  }

  set(key: string, facts: CommittedFacts): void {
    this.entries.delete(key)
    this.entries.set(key, facts)
    while (this.entries.size > CACHE_LIMIT) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) {
        break
      }
      this.entries.delete(oldest)
    }
  }

  get size(): number {
    return this.entries.size
  }
}

function nulSeparated(out: string): string[] {
  return out.split('\0').filter((entry) => entry.length > 0)
}

const DIFF = ['diff', '--name-only', '-z', '--no-renames', '--no-ext-diff', '--no-textconv']

/** Ahead and behind counts and the files the branch changes that still differ from the base. */
export async function readCommittedFacts(
  git: LostWorkGit,
  cwd: string,
  baseOid: string,
  head: string,
  signal?: AbortSignal
): Promise<CommittedFacts | null> {
  const counts = await tryGit(
    git,
    ['rev-list', '--left-right', '--count', `${baseOid}...${head}`],
    {
      cwd,
      signal
    }
  )
  const [behind, ahead] = (counts ?? '').trim().split(/\s+/).map(Number)
  if (!Number.isInteger(behind) || !Number.isInteger(ahead)) {
    return null
  }
  if (ahead === 0) {
    return { ahead, behind, files: [] }
  }
  const mergeBase = (await tryGit(git, ['merge-base', baseOid, head], { cwd, signal }))?.trim()
  if (!mergeBase || !LOST_WORK_OID.test(mergeBase)) {
    return null
  }
  const own = await tryGit(git, [...DIFF, mergeBase, head], { cwd, signal })
  // A squash-merged branch changes files that now match the base: those are not its own work.
  const differs = await tryGit(git, [...DIFF, baseOid, head], { cwd, signal })
  if (own === null || differs === null) {
    return null
  }
  const stillDiffers = new Set(nulSeparated(differs))
  return { ahead, behind, files: nulSeparated(own).filter((file) => stillDiffers.has(file)) }
}

/** Tracked changes and untracked files in the worktree, by path. */
export async function readUncommittedFiles(
  git: LostWorkGit,
  cwd: string,
  signal?: AbortSignal
): Promise<string[] | null> {
  const out = await tryGit(
    git,
    ['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all'],
    { cwd, signal }
  )
  // Each entry is "XY path"; --no-renames keeps one path per entry.
  return out === null ? null : nulSeparated(out).map((entry) => entry.slice(3))
}

async function readProjectKey(git: LostWorkGit, cwd: string, signal?: AbortSignal) {
  const remotes =
    (await tryGit(git, ['remote'], { cwd, signal }))?.split('\n').filter(Boolean) ?? []
  const remote = remotes.includes('origin') ? 'origin' : remotes[0]
  if (!remote) {
    return null
  }
  const url = await tryGit(git, ['remote', 'get-url', '--', remote], { cwd, signal })
  return url ? normalizeForkRemoteUrl(url) : null
}

async function readBranch(
  deps: ClashScanDeps,
  repo: ClashRepo,
  wt: GitWorktreeInfo,
  base: { oid: string; branch: string },
  cache: ForkClashCache,
  options: ClashScanOptions
): Promise<ForkClashBranch | 'skip' | 'failed'> {
  const branch = shortBranchName(wt.branch) ?? ''
  if (wt.isBare || !LOST_WORK_OID.test(wt.head) || branch === base.branch || wt.prunable) {
    return 'skip'
  }
  const key = `${wt.path}\u0000${wt.head}\u0000${base.oid}`
  let facts = cache.get(key)
  if (!facts) {
    const read = await readCommittedFacts(deps.git, wt.path, base.oid, wt.head, options.signal)
    if (!read) {
      return 'failed'
    }
    facts = read
    cache.set(key, facts)
  }
  let files = facts.files
  if (options.uncommitted) {
    const dirty = await readUncommittedFiles(deps.git, wt.path, options.signal)
    files = dirty && dirty.length > 0 ? [...new Set([...files, ...dirty])] : files
  }
  if (files.length === 0 && facts.ahead === 0 && facts.behind === 0) {
    return 'skip'
  }
  return {
    worktreeId: composeWorktreeId(repo.id, wt.path),
    path: wt.path,
    branch,
    head: wt.head,
    ahead: facts.ahead,
    behind: facts.behind,
    files: files.slice(0, FORK_CLASHES_MAX_FILES_PER_BRANCH),
    filesTruncated: files.length > FORK_CLASHES_MAX_FILES_PER_BRANCH
  }
}

/** One repository's unmerged worktree branches. Never throws for git trouble; it says so instead. */
export async function scanClashRepo(
  deps: ClashScanDeps,
  repo: ClashRepo,
  cache: ForkClashCache,
  options: ClashScanOptions
): Promise<ForkClashRepo> {
  const { signal } = options
  const projectKey = await readProjectKey(deps.git, repo.path, signal)
  const empty = { repoId: repo.id, name: repo.name, projectKey, branches: [] }
  const base = await resolveLostWorkBase(deps.git, repo.path, repo.defaultBranch, signal)
  if (!base?.oid) {
    return { ...empty, baseRef: null, incomplete: 'no default branch found' }
  }
  let worktrees: GitWorktreeInfo[]
  try {
    worktrees = await deps.listWorktrees(repo, signal)
  } catch (error) {
    if (signal?.aborted) {
      throw error
    }
    return { ...empty, baseRef: base.ref, incomplete: 'could not list worktrees' }
  }
  const baseFacts = { oid: base.oid, branch: base.branch }
  const read = await mapWithConcurrency(worktrees, WORKTREE_CONCURRENCY, (wt) =>
    readBranch(deps, repo, wt, baseFacts, cache, options)
  )
  const failed = read.filter((entry) => entry === 'failed').length
  return {
    ...empty,
    baseRef: base.ref,
    branches: read.filter((entry): entry is ForkClashBranch => typeof entry === 'object'),
    ...(failed > 0 ? { incomplete: `${failed} worktree(s) could not be compared` } : {})
  }
}
