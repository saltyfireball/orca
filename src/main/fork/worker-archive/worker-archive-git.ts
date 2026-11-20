// Worker archive (FORK.md, BAD-669): what a finished worker's checkout still holds. Landed means
// every commit on its branch is on a base branch, by ancestry or by patch (`git cherry`), since
// work lands by cherry-pick or fast-forward and resyncs rewrite shas. Every failure reads as
// null, which the decision treats as "unknown": the workspace stays.
import type { WorkerWorkspaceLanding } from '../../../shared/fork/worker-archive'
import {
  countDirtyFiles,
  countUnmergedCommits,
  resolveLostWorkBase,
  tryGit,
  type LostWorkGit
} from '../lost-work/lost-work-git'

const SAFE_REF = /^[A-Za-z0-9._/-]+$/

async function remoteDefaultRefs(git: LostWorkGit, cwd: string, signal?: AbortSignal) {
  const remotes = ((await tryGit(git, ['remote'], { cwd, signal })) ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const refs: string[] = []
  for (const remote of remotes) {
    const target = (
      (await tryGit(git, ['symbolic-ref', '--quiet', `refs/remotes/${remote}/HEAD`], {
        cwd,
        signal
      })) ?? ''
    ).trim()
    const prefix = 'refs/remotes/'
    if (target.startsWith(prefix)) {
      refs.push(target.slice(prefix.length))
    }
  }
  return refs
}

async function refExists(git: LostWorkGit, cwd: string, ref: string, signal?: AbortSignal) {
  if (!SAFE_REF.test(ref) || ref.startsWith('-')) {
    return false
  }
  const out = await tryGit(git, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
    cwd,
    signal
  })
  return (out?.trim().length ?? 0) > 0
}

/**
 * The branches work may have landed on: each remote's default branch, the project's default, and
 * the branch the workspace was created from. Several remotes are normal (a fork next to its
 * upstream), so a commit counts as landed when any of them has it.
 */
export async function workerArchiveBases(
  git: LostWorkGit,
  cwd: string,
  baseRef: string | undefined,
  signal?: AbortSignal
): Promise<string[]> {
  const found = new Set<string>(await remoteDefaultRefs(git, cwd, signal))
  const base = await resolveLostWorkBase(git, cwd, undefined, signal)
  if (base) {
    found.add(base.ref)
  }
  if (baseRef) {
    found.add(baseRef)
  }
  const bases: string[] = []
  for (const ref of found) {
    if (await refExists(git, cwd, ref, signal)) {
      bases.push(ref)
    }
  }
  return bases
}

/**
 * Uncommitted and untracked files (ignored build output does not count) and the commits on HEAD
 * that no base has. A branch with no commits of its own has none, so it reads as landed.
 */
export async function readWorkerArchiveLanding(
  git: LostWorkGit,
  cwd: string,
  baseRef: string | undefined,
  signal?: AbortSignal
): Promise<WorkerWorkspaceLanding> {
  const dirtyFiles = await countDirtyFiles(git, cwd, signal)
  const bases = await workerArchiveBases(git, cwd, baseRef, signal)
  if (bases.length === 0) {
    return { dirtyFiles, unlandedCommits: null }
  }
  let unlandedCommits: number | null = null
  for (const base of bases) {
    const count = await countUnmergedCommits(git, cwd, base, 'HEAD', signal)
    if (count !== null && (unlandedCommits === null || count < unlandedCommits)) {
      unlandedCommits = count
    }
  }
  return { dirtyFiles, unlandedCommits }
}
