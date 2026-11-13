// SLRM-2096: the read-only git questions the lost work scan asks. Every call goes through an
// injected runner, so the app uses its admitted git runner and tests use throwaway repos.
import { isSafeRefName } from '../../../shared/fork/lost-work'

export type LostWorkGitOptions = { cwd: string; signal?: AbortSignal; stdin?: string }
/** Runs git and resolves its stdout; rejects on a non-zero exit. */
export type LostWorkGit = (args: string[], options: LostWorkGitOptions) => Promise<string>

export type LostWorkBase = {
  /** What commits are compared with: `origin/main`, or `main` without a remote copy. */
  ref: string
  /** The local branch name, so worktrees on the default branch itself are skipped. */
  branch: string
}

const FALLBACK_DEFAULT_BRANCHES = ['main', 'master', 'trunk', 'develop']

async function tryGit(
  git: LostWorkGit,
  args: string[],
  options: LostWorkGitOptions
): Promise<string | null> {
  try {
    return await git(args, options)
  } catch (error) {
    if (options.signal?.aborted) {
      throw error
    }
    return null
  }
}

async function refExists(
  git: LostWorkGit,
  cwd: string,
  ref: string,
  signal?: AbortSignal
): Promise<boolean> {
  const out = await tryGit(git, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
    cwd,
    signal
  })
  return out !== null && out.trim().length > 0
}

async function listRemotes(git: LostWorkGit, cwd: string, signal?: AbortSignal) {
  const out = await tryGit(git, ['remote'], { cwd, signal })
  const remotes = (out ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  // origin first: it is what clones and hosting CLIs call the canonical remote.
  return remotes.includes('origin')
    ? ['origin', ...remotes.filter((remote) => remote !== 'origin')]
    : remotes
}

/** The remote copy of a branch when there is one (fresher than a stale local copy), else local. */
async function pickBaseRef(
  git: LostWorkGit,
  cwd: string,
  branch: string,
  remotes: string[],
  signal?: AbortSignal
): Promise<LostWorkBase | null> {
  for (const remote of remotes) {
    if (await refExists(git, cwd, `refs/remotes/${remote}/${branch}`, signal)) {
      return { ref: `${remote}/${branch}`, branch }
    }
  }
  if (await refExists(git, cwd, `refs/heads/${branch}`, signal)) {
    return { ref: branch, branch }
  }
  return null
}

/** The branch work is meant to land on: the override, the remote's HEAD, or a common name. */
export async function resolveLostWorkBase(
  git: LostWorkGit,
  cwd: string,
  override: string | undefined,
  signal?: AbortSignal
): Promise<LostWorkBase | null> {
  const remotes = await listRemotes(git, cwd, signal)
  if (override) {
    const stripped = remotes.find((remote) => override.startsWith(`${remote}/`))
    const branch = stripped ? override.slice(stripped.length + 1) : override
    return isSafeRefName(branch) ? pickBaseRef(git, cwd, branch, remotes, signal) : null
  }
  for (const remote of remotes) {
    const head = await tryGit(git, ['symbolic-ref', '--quiet', `refs/remotes/${remote}/HEAD`], {
      cwd,
      signal
    })
    const prefix = `refs/remotes/${remote}/`
    const target = head?.trim()
    if (target?.startsWith(prefix)) {
      const found = await pickBaseRef(git, cwd, target.slice(prefix.length), remotes, signal)
      if (found) {
        return found
      }
    }
  }
  for (const branch of FALLBACK_DEFAULT_BRANCHES) {
    const found = await pickBaseRef(git, cwd, branch, remotes, signal)
    if (found) {
      return found
    }
  }
  return null
}

/** Commits on `tip` whose change is not on `base`, matched by patch-id, so rebase merges count. */
export async function countUnmergedCommits(
  git: LostWorkGit,
  cwd: string,
  base: string,
  tip: string,
  signal?: AbortSignal
): Promise<number | null> {
  const out = await tryGit(git, ['cherry', base, tip], { cwd, signal })
  if (out === null) {
    return null
  }
  return out.split('\n').filter((line) => line.startsWith('+')).length
}

/** Commits on `tip` that are neither on `base` nor on any remote: what deleting `tip` would lose. */
export async function countUnpushedCommits(
  git: LostWorkGit,
  cwd: string,
  base: string | null,
  tip: string,
  signal?: AbortSignal
): Promise<number | null> {
  const args = ['rev-list', '--count', tip, '--not', ...(base ? [base] : []), '--remotes']
  const out = await tryGit(git, args, { cwd, signal })
  const count = out === null ? Number.NaN : Number.parseInt(out.trim(), 10)
  return Number.isFinite(count) ? count : null
}

/** Commits on `tip` past a pull request's head that the base does not have either. */
export async function countCommitsPast(
  git: LostWorkGit,
  cwd: string,
  base: string | null,
  past: string,
  tip: string,
  signal?: AbortSignal
): Promise<number | null> {
  if (!/^[0-9a-f]{7,64}$/i.test(past)) {
    return null
  }
  const args = ['rev-list', '--count', tip, '--not', past, ...(base ? [base] : [])]
  const out = await tryGit(git, args, { cwd, signal })
  const count = out === null ? Number.NaN : Number.parseInt(out.trim(), 10)
  return Number.isFinite(count) ? count : null
}

async function patchIds(
  git: LostWorkGit,
  cwd: string,
  patch: string,
  signal?: AbortSignal
): Promise<string[]> {
  if (!patch.trim()) {
    return []
  }
  const out = await tryGit(git, ['patch-id', '--stable'], { cwd, signal, stdin: patch })
  return (out ?? '')
    .split('\n')
    .map((line) => line.split(' ')[0])
    .filter((id) => /^[0-9a-f]{40,64}$/.test(id))
}

/** Patch-ids of the base's recent single-parent commits, where a squash merge lands. */
export async function readBasePatchIds(
  git: LostWorkGit,
  cwd: string,
  base: string,
  lookback: number,
  signal?: AbortSignal
): Promise<Set<string>> {
  if (lookback <= 0) {
    return new Set()
  }
  const log = await tryGit(
    git,
    ['log', '-p', '--no-merges', '--no-color', '--no-ext-diff', `--max-count=${lookback}`, base],
    { cwd, signal }
  )
  return new Set(log ? await patchIds(git, cwd, log, signal) : [])
}

/**
 * True when the whole branch, as one change from where it left the base, is a commit already on
 * the base: a squash merge. Null when it cannot tell.
 */
export async function isSquashMerged(
  git: LostWorkGit,
  cwd: string,
  base: string,
  tip: string,
  basePatchIds: () => Promise<Set<string>>,
  signal?: AbortSignal
): Promise<boolean | null> {
  const mergeBase = (await tryGit(git, ['merge-base', base, tip], { cwd, signal }))?.trim()
  if (!mergeBase) {
    return null
  }
  const diff = await tryGit(git, ['diff', '--no-color', '--no-ext-diff', mergeBase, tip], {
    cwd,
    signal
  })
  if (diff === null) {
    return null
  }
  const [id] = await patchIds(git, cwd, diff, signal)
  // No net change from the base: nothing on the branch would be lost.
  if (!id) {
    return diff.trim().length === 0
  }
  return (await basePatchIds()).has(id)
}

/** Changed, staged and untracked entries; null when git cannot read the folder. */
export async function countDirtyFiles(
  git: LostWorkGit,
  cwd: string,
  signal?: AbortSignal
): Promise<number | null> {
  const out = await tryGit(git, ['status', '--porcelain=v1', '-z', '--untracked-files=normal'], {
    cwd,
    signal
  })
  if (out === null) {
    return null
  }
  const fields = out.split('\0')
  let count = 0
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]
    if (field.length < 4) {
      continue
    }
    count += 1
    // A rename or copy is followed by its source path, which is not another entry.
    if (field[0] === 'R' || field[0] === 'C') {
      index += 1
    }
  }
  return count
}

export async function readLastCommitAt(
  git: LostWorkGit,
  cwd: string,
  ref: string,
  signal?: AbortSignal
): Promise<number | null> {
  const out = await tryGit(git, ['log', '-1', '--format=%ct', ref, '--'], { cwd, signal })
  const seconds = out === null ? Number.NaN : Number.parseInt(out.trim(), 10)
  return Number.isFinite(seconds) ? seconds * 1000 : null
}

export type LostWorkLocalBranch = { name: string; head: string; committedAt: number | null }

export async function listLocalBranches(
  git: LostWorkGit,
  cwd: string,
  signal?: AbortSignal
): Promise<LostWorkLocalBranch[]> {
  const out = await git(
    [
      'for-each-ref',
      '--format=%(refname:short)%00%(objectname)%00%(committerdate:unix)',
      'refs/heads'
    ],
    { cwd, signal }
  )
  return out
    .split('\n')
    .map((line) => line.split('\0'))
    .filter((parts) => parts.length === 3 && parts[0] && isSafeRefName(parts[0]))
    .map(([name, head, date]) => {
      const seconds = Number.parseInt(date, 10)
      return { name, head, committedAt: Number.isFinite(seconds) ? seconds * 1000 : null }
    })
}

export type LostWorkStash = {
  index: number
  head: string
  createdAt: number | null
  message: string
}

export async function listStashes(
  git: LostWorkGit,
  cwd: string,
  signal?: AbortSignal
): Promise<LostWorkStash[]> {
  const out = await tryGit(git, ['stash', 'list', '--format=%H%x00%ct%x00%gs'], { cwd, signal })
  return (out ?? '')
    .split('\n')
    .map((line) => line.split('\0'))
    .filter((parts) => parts.length === 3 && /^[0-9a-f]{40,64}$/.test(parts[0]))
    .map(([head, date, message], index) => {
      const seconds = Number.parseInt(date, 10)
      return {
        index,
        head,
        createdAt: Number.isFinite(seconds) ? seconds * 1000 : null,
        message
      }
    })
}

/** `refs/heads/x` or `x` to `x`; empty (a detached HEAD) to null. */
export function shortBranchName(branch: string | undefined): string | null {
  const name = (branch ?? '').replace(/^refs\/heads\//, '')
  return name.length > 0 ? name : null
}
