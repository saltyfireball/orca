// Worker cleanup (FORK.md): what a finished worker's worktree still holds, and whether its work
// landed. Reuses the lost work scan's git helpers; every failure reads as "not known", which the
// sweep treats as a reason to leave the worker open.
import {
  countDirtyFiles,
  countUnmergedCommits,
  countUnpushedCommits,
  resolveLostWorkBase,
  type LostWorkGit
} from '../lost-work/lost-work-git'

export type WorkerCleanupGh = (
  args: string[],
  options: { cwd: string; signal?: AbortSignal }
) => Promise<string>

export type WorkerWorktreeState = {
  /** Changed, staged or untracked files; null when git could not read the folder. */
  dirty: number | null
  /** Commits on HEAD that no remote and not the default branch has; null when unknown. */
  unpushed: number | null
}

export async function readWorkerWorktreeState(
  git: LostWorkGit,
  cwd: string,
  signal?: AbortSignal
): Promise<WorkerWorktreeState> {
  const dirty = await countDirtyFiles(git, cwd, signal)
  const base = await resolveLostWorkBase(git, cwd, undefined, signal)
  const unpushed = await countUnpushedCommits(git, cwd, base?.ref ?? null, 'HEAD', signal)
  return { dirty, unpushed }
}

async function currentBranch(
  git: LostWorkGit,
  cwd: string,
  signal?: AbortSignal
): Promise<string | null> {
  try {
    const name = (await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd, signal })).trim()
    return name.length > 0 ? name : null
  } catch {
    return null
  }
}

/** A merged pull request for `branch`; null when gh is missing, signed out or not GitHub. */
async function hasMergedPullRequest(
  gh: WorkerCleanupGh,
  cwd: string,
  branch: string,
  signal?: AbortSignal
): Promise<boolean | null> {
  try {
    const out = await gh(
      ['pr', 'list', '--head', branch, '--state', 'merged', '--json', 'number', '--limit', '1'],
      { cwd, signal }
    )
    const parsed: unknown = JSON.parse(out)
    return Array.isArray(parsed) ? parsed.length > 0 : null
  } catch {
    return null
  }
}

/**
 * Whether the worker's work landed: its branch has a merged pull request, or it made commits and
 * every one of them is on the default branch (by patch, so rebase merges count). A branch with no
 * commits of its own has nothing that could have merged, so it reads as not merged.
 */
export async function isWorkerBranchMerged(
  git: LostWorkGit,
  gh: WorkerCleanupGh | null,
  cwd: string,
  signal?: AbortSignal
): Promise<boolean> {
  const branch = await currentBranch(git, cwd, signal)
  const base = await resolveLostWorkBase(git, cwd, undefined, signal)
  if (gh && branch && branch !== base?.branch) {
    if ((await hasMergedPullRequest(gh, cwd, branch, signal)) === true) {
      return true
    }
  }
  if (!base || !branch || branch === base.branch) {
    return false
  }
  if (!(await madeOwnCommits(git, cwd, branch, signal))) {
    return false
  }
  return (await countUnmergedCommits(git, cwd, base.ref, 'HEAD', signal)) === 0
}

/** The branch moved past where it was created (its oldest reflog entry); false when unknown. */
async function madeOwnCommits(
  git: LostWorkGit,
  cwd: string,
  branch: string,
  signal?: AbortSignal
): Promise<boolean> {
  try {
    const log = await git(['reflog', 'show', '--format=%H', `refs/heads/${branch}`, '--'], {
      cwd,
      signal
    })
    const created = log.trim().split('\n').at(-1)?.trim()
    if (!created || !/^[0-9a-f]{7,64}$/i.test(created)) {
      return false
    }
    const count = await git(['rev-list', '--count', `${created}..HEAD`], {
      cwd,
      signal
    })
    return Number.parseInt(count.trim(), 10) > 0
  } catch {
    return false
  }
}
