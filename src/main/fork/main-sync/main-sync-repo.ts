// Keep main current (SLRM-2384, FORK.md): one project's pass. Fetch the default branch from its
// remote with the git runner the app already uses (so configured credentials and SSH apply), then
// move the local branch only by a fast-forward, and only when nobody can lose anything:
// - a branch checked out in a linked worktree is left alone (someone works there);
// - in the main checkout it moves with `git merge --ff-only` only when the checkout is clean, no
//   merge, rebase, cherry-pick, revert or bisect is under way, and (by default) no terminal or agent
//   is live in it;
// - a branch checked out nowhere moves with a compare-and-swap `update-ref`.
// Diverged or ahead branches are never touched. Every git call goes through an injected runner.
import { access } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { isSafeRefName } from '../../../shared/fork/lost-work'
import type { ForkMainSyncReason, ForkMainSyncRepoResult } from '../../../shared/fork/main-sync'
import { parseWorktreeList } from '../../../shared/git/worktrees/git-worktree-porcelain-parser'

export type MainSyncGitOptions = { cwd: string; network?: boolean; signal?: AbortSignal }
/** Runs git and resolves its stdout; rejects on a non-zero exit with git's message. */
export type MainSyncGit = (args: string[], options: MainSyncGitOptions) => Promise<string>

export type MainSyncRepo = { id: string; name: string; path: string }

export type MainSyncRepoDeps = {
  git: MainSyncGit
  /** The branch override for this project (Lost work's per-project default branch), if any. */
  defaultBranchOverride?: (repoId: string) => string | undefined
  /** True when the checkout at this path has live terminals or a working agent. */
  isCheckoutInUse?: (path: string) => boolean
  pathExists?: (path: string) => Promise<boolean>
  now?: () => number
}

const FALLBACK_BRANCHES = ['main', 'master', 'trunk', 'develop']
const OID = /^[0-9a-f]{40,64}$/
/** Files git keeps while an operation is under way; the checkout is then not ours to move. */
const OPERATION_MARKERS = [
  'MERGE_HEAD',
  'CHERRY_PICK_HEAD',
  'REVERT_HEAD',
  'BISECT_LOG',
  'rebase-merge',
  'rebase-apply',
  'index.lock'
]

async function tryGit(
  deps: MainSyncRepoDeps,
  args: string[],
  options: MainSyncGitOptions
): Promise<string | null> {
  try {
    return await deps.git(args, options)
  } catch (error) {
    if (options.signal?.aborted) {
      throw error
    }
    return null
  }
}

async function defaultPathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function errorLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  const line = text.split('\n').find((entry) => entry.trim()) ?? ''
  // Control characters from a remote's message would garble the log and the table.
  // eslint-disable-next-line no-control-regex
  const controls = /[\u0000-\u001f\u007f]/g
  return line.replace(controls, ' ').trim().slice(0, 300)
}

async function refOid(
  deps: MainSyncRepoDeps,
  cwd: string,
  ref: string,
  signal?: AbortSignal
): Promise<string | null> {
  const out = await tryGit(deps, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
    cwd,
    signal
  })
  const oid = out?.trim() ?? ''
  return OID.test(oid) ? oid : null
}

async function listRemotes(deps: MainSyncRepoDeps, cwd: string, signal?: AbortSignal) {
  const out = (await tryGit(deps, ['remote'], { cwd, signal })) ?? ''
  const remotes = out
    .split('\n')
    .map((line) => line.trim())
    .filter((name) => name && isSafeRefName(name))
  return remotes.includes('origin')
    ? ['origin', ...remotes.filter((remote) => remote !== 'origin')]
    : remotes
}

async function configValue(
  deps: MainSyncRepoDeps,
  cwd: string,
  key: string,
  signal?: AbortSignal
): Promise<string | null> {
  const out = await tryGit(deps, ['config', '--get', key], { cwd, signal })
  const value = out?.trim() ?? ''
  return value || null
}

export type MainSyncTarget = {
  branch: string
  remote: string | null
  /** The branch's name on the remote. */
  remoteBranch: string
}

/** The local default branch and the remote branch it follows. */
export async function resolveMainSyncTarget(
  deps: MainSyncRepoDeps,
  repo: MainSyncRepo,
  signal?: AbortSignal
): Promise<MainSyncTarget | null> {
  const cwd = repo.path
  const remotes = await listRemotes(deps, cwd, signal)
  let branch: string | null = null
  let headRemote: string | null = null
  const override = deps.defaultBranchOverride?.(repo.id)?.trim()
  if (override) {
    const prefix = remotes.find((remote) => override.startsWith(`${remote}/`))
    branch = prefix ? override.slice(prefix.length + 1) : override
  }
  if (!branch) {
    for (const remote of remotes) {
      const head = (
        await tryGit(deps, ['symbolic-ref', '--quiet', `refs/remotes/${remote}/HEAD`], {
          cwd,
          signal
        })
      )?.trim()
      const prefix = `refs/remotes/${remote}/`
      if (head?.startsWith(prefix)) {
        branch = head.slice(prefix.length)
        headRemote = remote
        break
      }
    }
  }
  if (!branch) {
    for (const candidate of FALLBACK_BRANCHES) {
      if (await refOid(deps, cwd, `refs/heads/${candidate}`, signal)) {
        branch = candidate
        break
      }
    }
  }
  if (!branch || !isSafeRefName(branch)) {
    return null
  }
  // The branch's own upstream wins: that is what `git pull` on it would use.
  const configuredRemote = await configValue(deps, cwd, `branch.${branch}.remote`, signal)
  const remote =
    configuredRemote && remotes.includes(configuredRemote)
      ? configuredRemote
      : (headRemote ?? (remotes.includes('origin') ? 'origin' : (remotes[0] ?? null)))
  const merge = await configValue(deps, cwd, `branch.${branch}.merge`, signal)
  const mergeBranch =
    remote === configuredRemote && merge?.startsWith('refs/heads/')
      ? merge.slice('refs/heads/'.length)
      : null
  const remoteBranch = mergeBranch && isSafeRefName(mergeBranch) ? mergeBranch : branch
  return { branch, remote, remoteBranch }
}

async function isAncestor(
  deps: MainSyncRepoDeps,
  cwd: string,
  ancestor: string,
  of: string,
  signal?: AbortSignal
): Promise<boolean> {
  return (
    (await tryGit(deps, ['merge-base', '--is-ancestor', ancestor, of], { cwd, signal })) !== null
  )
}

async function operationUnderWay(
  deps: MainSyncRepoDeps,
  cwd: string,
  signal?: AbortSignal
): Promise<boolean> {
  const exists = deps.pathExists ?? defaultPathExists
  for (const marker of OPERATION_MARKERS) {
    const out = (await tryGit(deps, ['rev-parse', '--git-path', marker], { cwd, signal }))?.trim()
    if (!out) {
      return true
    }
    if (await exists(isAbsolute(out) ? out : join(cwd, out))) {
      return true
    }
  }
  return false
}

/** One project's pass. Never throws, except when `signal` aborts. */
export async function syncMainSyncRepo(
  deps: MainSyncRepoDeps,
  repo: MainSyncRepo,
  signal?: AbortSignal
): Promise<ForkMainSyncRepoResult> {
  const now = deps.now ?? Date.now
  const base = { repoId: repo.id, name: repo.name, branch: null, remoteRef: null }
  const done = (
    fields: Partial<ForkMainSyncRepoResult> & Pick<ForkMainSyncRepoResult, 'outcome'>,
    reason: ForkMainSyncReason
  ): ForkMainSyncRepoResult => ({ ...base, ...fields, reason, at: now() })
  if (!(await (deps.pathExists ?? defaultPathExists)(repo.path))) {
    return done({ outcome: 'skipped' }, 'missing-folder')
  }
  const target = await resolveMainSyncTarget(deps, repo, signal)
  if (!target) {
    return done({ outcome: 'skipped' }, 'no-default-branch')
  }
  const { branch, remote, remoteBranch } = target
  if (!remote) {
    return done({ outcome: 'skipped', branch }, 'no-remote')
  }
  const remoteRef = `${remote}/${remoteBranch}`
  const named = { branch, remoteRef }
  try {
    // Only this branch, no tags, FETCH_HEAD untouched; the configured refspec updates remoteRef.
    await deps.git(
      ['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', remote, remoteBranch],
      { cwd: repo.path, network: true, signal }
    )
  } catch (error) {
    if (signal?.aborted) {
      throw error
    }
    return done({ outcome: 'failed', ...named, detail: errorLine(error) }, 'fetch-failed')
  }
  const remoteOid = await refOid(deps, repo.path, `refs/remotes/${remoteRef}`, signal)
  if (!remoteOid) {
    return done({ outcome: 'skipped', ...named }, 'no-remote-branch')
  }
  const localOid = await refOid(deps, repo.path, `refs/heads/${branch}`, signal)
  if (!localOid) {
    return done({ outcome: 'current', ...named }, 'fetched-only')
  }
  if (localOid === remoteOid) {
    return done({ outcome: 'current', ...named }, 'up-to-date')
  }
  if (await isAncestor(deps, repo.path, remoteOid, localOid, signal)) {
    return done({ outcome: 'current', ...named }, 'ahead')
  }
  if (!(await isAncestor(deps, repo.path, localOid, remoteOid, signal))) {
    return done({ outcome: 'skipped', ...named }, 'diverged')
  }
  const moved = { ...named, from: localOid.slice(0, 12), to: remoteOid.slice(0, 12) }
  // -z keeps odd paths intact; git before 2.36 has no -z, so fall back to the line form.
  const nul = await tryGit(deps, ['worktree', 'list', '--porcelain', '-z'], {
    cwd: repo.path,
    signal
  })
  const list =
    nul ?? (await tryGit(deps, ['worktree', 'list', '--porcelain'], { cwd: repo.path, signal }))
  if (list === null) {
    return done(
      { outcome: 'failed', ...named, detail: 'git worktree list failed' },
      'update-failed'
    )
  }
  const holders = parseWorktreeList(list, { nulDelimited: nul !== null }).filter(
    (entry) => entry.branch === `refs/heads/${branch}`
  )
  if (holders.some((entry) => !entry.isMainWorktree)) {
    return done({ outcome: 'skipped', ...named }, 'checked-out-elsewhere')
  }
  const checkout = holders[0]
  try {
    if (!checkout) {
      // Checked out nowhere: move the ref only if it still points where we read it.
      await deps.git(
        [
          'update-ref',
          '-m',
          `blackfish main sync: fast-forward to ${remoteRef}`,
          `refs/heads/${branch}`,
          remoteOid,
          localOid
        ],
        { cwd: repo.path, signal }
      )
      return done({ outcome: 'updated', ...moved }, 'ref-moved')
    }
    if (deps.isCheckoutInUse?.(checkout.path)) {
      return done({ outcome: 'skipped', ...named }, 'in-use')
    }
    const cwd = checkout.path
    if (await operationUnderWay(deps, cwd, signal)) {
      return done({ outcome: 'skipped', ...named }, 'operation')
    }
    const status = await deps.git(['status', '--porcelain', '--untracked-files=no'], {
      cwd,
      signal
    })
    if (status.trim()) {
      return done({ outcome: 'skipped', ...named }, 'dirty')
    }
    const head = (await tryGit(deps, ['symbolic-ref', '--quiet', 'HEAD'], { cwd, signal }))?.trim()
    const headOid = await refOid(deps, cwd, 'HEAD', signal)
    if (head !== `refs/heads/${branch}` || headOid !== localOid) {
      // The checkout moved since the worktree list; the next pass looks again.
      return done({ outcome: 'skipped', ...named }, 'operation')
    }
    // --ff-only refuses anything but a fast-forward and any change to a local edit.
    await deps.git(['merge', '--ff-only', '--no-autostash', '--no-stat', '--quiet', remoteOid], {
      cwd,
      signal
    })
    return done({ outcome: 'updated', ...moved }, 'fast-forwarded')
  } catch (error) {
    if (signal?.aborted) {
      throw error
    }
    return done({ outcome: 'failed', ...named, detail: errorLine(error) }, 'update-failed')
  }
}
