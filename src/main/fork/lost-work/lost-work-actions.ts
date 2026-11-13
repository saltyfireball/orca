// SLRM-2096: what the lost work list can do to one item. The renderer's copy of the item is only a
// request: each action checks the repo, branch, stash or folder against git again before it acts,
// and a deletion that would lose commits needs `confirmedLoss`. Removing a worktree Orca tracks is
// not here: the renderer uses Orca's own guarded removal for that.
import { constants as fsConstants } from 'node:fs'
import { access, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import {
  isSafeRefName,
  type LostWorkActionArgs,
  type LostWorkActionResult,
  type LostWorkItem
} from '../../../shared/fork/lost-work'
import {
  countDirtyFiles,
  countUnpushedCommits,
  shortBranchName,
  type LostWorkGit
} from './lost-work-git'
import type { LostWorkRepo, LostWorkScanDeps } from './lost-work-scan'
import { pullRequestCompareUrl, remoteWebUrl } from './lost-work-links'
import { fileStamp, safeName } from './lost-work-names'

export type LostWorkActionDeps = Pick<
  LostWorkScanDeps,
  'git' | 'listWorktrees' | 'pathExists' | 'isTracked'
> & {
  /** Local git repos only; null for an unknown, remote or folder project. */
  findRepo: (repoId: string) => LostWorkRepo | null
  now?: () => number
}

class ActionRefused extends Error {}

function refuse(message: string): never {
  throw new ActionRefused(message)
}

const SHA = /^[0-9a-f]{40,64}$/

function requireBranch(item: LostWorkItem): string {
  const branch = item.branch
  if (!branch || !isSafeRefName(branch)) {
    refuse('This item has no branch.')
  }
  return branch
}

async function readRef(git: LostWorkGit, cwd: string, ref: string): Promise<string | null> {
  try {
    return (await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd })).trim()
  } catch {
    return null
  }
}

/** The branch must still point where the scan saw it, or the user is acting on stale facts. */
async function requireBranchAt(git: LostWorkGit, repo: LostWorkRepo, item: LostWorkItem) {
  const branch = requireBranch(item)
  const head = await readRef(git, repo.path, `refs/heads/${branch}`)
  if (!head) {
    refuse(`Branch ${branch} no longer exists.`)
  }
  if (item.head && head !== item.head) {
    refuse(`Branch ${branch} has moved since the scan. Scan again first.`)
  }
  return { branch, head }
}

async function pickRemote(git: LostWorkGit, cwd: string, branch: string): Promise<string> {
  const configured = await git(['config', '--get', `branch.${branch}.remote`], { cwd }).catch(
    () => ''
  )
  const remotes = (await git(['remote'], { cwd }).catch(() => ''))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const remote = [configured.trim(), 'origin', remotes[0]].find(
    (candidate) => candidate && remotes.includes(candidate)
  )
  return remote ?? refuse('This repository has no remote to push to.')
}

async function requireFolder(folder: string | undefined): Promise<string> {
  if (!folder || !isAbsolute(folder)) {
    refuse('Choose a folder to save to.')
  }
  const info = await stat(folder).catch(() => null)
  if (!info?.isDirectory()) {
    refuse('The archive folder does not exist.')
  }
  await access(folder, fsConstants.W_OK).catch(() => refuse('The archive folder is not writable.'))
  return folder
}

function baseName(repo: LostWorkRepo, item: LostWorkItem): string {
  const what = item.stash ? `stash-${item.head?.slice(0, 10)}` : (item.branch ?? 'detached')
  return `${safeName(repo.name)}-${safeName(what)}`
}

/** Plain base name of the remote-tracking base, which the scan reported, checked again here. */
async function requireBase(git: LostWorkGit, cwd: string, item: LostWorkItem): Promise<string> {
  const base = item.baseRef
  if (!base || !isSafeRefName(base) || !(await readRef(git, cwd, base))) {
    refuse('There is no base branch to compare with. Set one in Settings.')
  }
  return base
}

/** Where the item's commits are read: the worktree for a detached HEAD, else the repo. */
async function resolveTip(deps: LostWorkActionDeps, repo: LostWorkRepo, item: LostWorkItem) {
  if (item.kind === 'stash') {
    const head = item.head && SHA.test(item.head) ? item.head : refuse('Unknown stash.')
    return { cwd: repo.path, tip: head }
  }
  if (item.branch) {
    const { branch } = await requireBranchAt(deps.git, repo, item)
    return { cwd: repo.path, tip: `refs/heads/${branch}` }
  }
  const worktree = await requireListedWorktree(deps, repo, item)
  if (!deps.pathExists(worktree.path)) {
    refuse('The worktree folder is gone.')
  }
  return { cwd: worktree.path, tip: 'HEAD' }
}

async function requireListedWorktree(
  deps: LostWorkActionDeps,
  repo: LostWorkRepo,
  item: LostWorkItem
) {
  const worktrees = await deps.listWorktrees(repo)
  const found = worktrees.find(
    (worktree) => worktree.path === item.path && !worktree.isMainWorktree
  )
  return found ?? refuse('Git no longer lists this worktree.')
}

/** Tracked-file changes not yet committed, which no bundle or format-patch carries. */
async function uncommittedPatch(deps: LostWorkActionDeps, item: LostWorkItem, repo: LostWorkRepo) {
  if (!item.path || item.kind === 'branch' || item.kind === 'stash') {
    return ''
  }
  const worktree = await requireListedWorktree(deps, repo, item)
  if (!deps.pathExists(worktree.path)) {
    return ''
  }
  return deps.git(['diff', '--binary', '--no-color', '--no-ext-diff', 'HEAD'], {
    cwd: worktree.path
  })
}

async function save(
  deps: LostWorkActionDeps,
  repo: LostWorkRepo,
  args: LostWorkActionArgs
): Promise<string[]> {
  const folder = await requireFolder(args.folder)
  const { item } = args
  const stem = join(folder, `${baseName(repo, item)}-${fileStamp((deps.now ?? Date.now)())}`)
  const files: string[] = []
  const { cwd, tip } = await resolveTip(deps, repo, item)
  if (args.action === 'save-bundle') {
    if (item.kind === 'stash') {
      refuse('Save a stash as a patch.')
    }
    const base = item.baseRef ? await readRef(deps.git, cwd, item.baseRef) : null
    const range = base ? [tip, `^${base}`] : [tip]
    const file = `${stem}.bundle`
    // Fails on an existing file, so nothing is overwritten. A branch fully on the base has no
    // range to bundle, so it falls back to the whole branch.
    if (
      await access(file).then(
        () => true,
        () => false
      )
    ) {
      refuse('A file with that name already exists.')
    }
    await deps.git(['bundle', 'create', file, ...range], { cwd }).catch(async () => {
      await deps.git(['bundle', 'create', file, tip], { cwd })
    })
    files.push(file)
  } else if (item.kind === 'stash') {
    const patch = await deps
      .git(['stash', 'show', '-p', '--binary', '--include-untracked', tip], { cwd })
      .catch(() => deps.git(['stash', 'show', '-p', '--binary', tip], { cwd }))
    await writeFile(`${stem}.patch`, patch, { flag: 'wx' })
    files.push(`${stem}.patch`)
  } else {
    const base = await requireBase(deps.git, repo.path, item)
    const patch = await deps.git(['format-patch', '--stdout', '--binary', `${base}..${tip}`], {
      cwd
    })
    if (patch.trim()) {
      await writeFile(`${stem}.patch`, patch, { flag: 'wx' })
      files.push(`${stem}.patch`)
    }
  }
  const uncommitted = await uncommittedPatch(deps, item, repo)
  if (uncommitted.trim()) {
    await writeFile(`${stem}-uncommitted.patch`, uncommitted, { flag: 'wx' })
    files.push(`${stem}-uncommitted.patch`)
  }
  if (files.length === 0) {
    refuse('There was nothing to save: every commit is already on the base.')
  }
  return files
}

async function deleteBranch(
  deps: LostWorkActionDeps,
  repo: LostWorkRepo,
  args: LostWorkActionArgs
) {
  const { branch, head } = await requireBranchAt(deps.git, repo, args.item)
  const base = args.item.baseRef && isSafeRefName(args.item.baseRef) ? args.item.baseRef : null
  const unpushed = await countUnpushedCommits(deps.git, repo.path, base, head)
  if ((unpushed === null || unpushed > 0) && args.confirmedLoss !== true) {
    refuse(`Branch ${branch} has commits that exist nowhere else. Confirm the loss to delete it.`)
  }
  await deps.git(['branch', '-D', '--', branch], { cwd: repo.path })
}

async function dropStash(deps: LostWorkActionDeps, repo: LostWorkRepo, args: LostWorkActionArgs) {
  if (args.confirmedLoss !== true) {
    refuse('Dropping a stash loses its changes. Confirm the loss to drop it.')
  }
  const head = args.item.head
  const list = await deps.git(['stash', 'list', '--format=%H'], { cwd: repo.path })
  const index = list.split('\n').findIndex((line) => line.trim() === head)
  if (index === -1) {
    refuse('That stash is gone.')
  }
  await deps.git(['stash', 'drop', '--quiet', `stash@{${index}}`], { cwd: repo.path })
}

async function pruneWorktree(deps: LostWorkActionDeps, repo: LostWorkRepo, item: LostWorkItem) {
  const worktree = await requireListedWorktree(deps, repo, item)
  if (deps.pathExists(worktree.path)) {
    refuse('The worktree folder still exists. Delete the worktree instead.')
  }
  // Prune only forgets registrations whose folder is gone; branches and commits stay.
  await deps.git(['worktree', 'prune'], { cwd: repo.path })
}

/** A worktree Orca keeps no state for: git removes it; its branch and commits stay. */
async function removeUntrackedWorktree(
  deps: LostWorkActionDeps,
  repo: LostWorkRepo,
  args: LostWorkActionArgs
) {
  const worktree = await requireListedWorktree(deps, repo, args.item)
  if (deps.isTracked(`${repo.id}::${worktree.path}`)) {
    refuse('Orca tracks this worktree now. Scan again and delete it as a workspace.')
  }
  if (!deps.pathExists(worktree.path)) {
    refuse('The worktree folder is gone. Forget it instead.')
  }
  if (worktree.locked) {
    refuse('Git has this worktree locked. Unlock it with git first.')
  }
  const dirty = await countDirtyFiles(deps.git, worktree.path)
  const base = args.item.baseRef && isSafeRefName(args.item.baseRef) ? args.item.baseRef : null
  // A branch keeps its commits after the folder goes; a detached HEAD does not.
  const unpushed = worktree.branch
    ? 0
    : await countUnpushedCommits(deps.git, repo.path, base, worktree.head || 'HEAD')
  const losesWork = dirty !== 0 || unpushed !== 0
  if (losesWork && args.confirmedLoss !== true) {
    refuse('This worktree has changes or commits that exist nowhere else. Confirm the loss.')
  }
  await deps.git(['worktree', 'remove', ...(losesWork ? ['--force'] : []), worktree.path], {
    cwd: repo.path
  })
}

async function push(deps: LostWorkActionDeps, repo: LostWorkRepo, item: LostWorkItem) {
  const { branch } = await requireBranchAt(deps.git, repo, item)
  const remote = await pickRemote(deps.git, repo.path, branch)
  await deps.git(['push', '--set-upstream', remote, `refs/heads/${branch}:refs/heads/${branch}`], {
    cwd: repo.path
  })
}

async function createPullRequestUrl(
  deps: LostWorkActionDeps,
  repo: LostWorkRepo,
  item: LostWorkItem
) {
  const { branch } = await requireBranchAt(deps.git, repo, item)
  const remote = await pickRemote(deps.git, repo.path, branch)
  const remoteUrl = await deps.git(['remote', 'get-url', remote], { cwd: repo.path })
  const web = remoteWebUrl(remoteUrl)
  const baseBranch = shortBranchName(item.baseRef?.replace(`${remote}/`, ''))
  const url = web && baseBranch ? pullRequestCompareUrl(web, baseBranch, branch) : null
  return url ?? refuse('Open the pull request on your hosting site; only GitHub links are built.')
}

export async function runLostWorkAction(
  deps: LostWorkActionDeps,
  args: LostWorkActionArgs
): Promise<LostWorkActionResult> {
  try {
    const repo = deps.findRepo(args.item?.repoId) ?? refuse('That project is not a local git repo.')
    switch (args.action) {
      case 'push':
        await push(deps, repo, args.item)
        return { ok: true }
      case 'create-pull-request':
        return { ok: true, url: await createPullRequestUrl(deps, repo, args.item) }
      case 'save-bundle':
      case 'save-patch':
        return { ok: true, files: await save(deps, repo, args) }
      case 'delete-branch':
        await deleteBranch(deps, repo, args)
        return { ok: true }
      case 'drop-stash':
        await dropStash(deps, repo, args)
        return { ok: true }
      case 'prune-worktree':
        await pruneWorktree(deps, repo, args.item)
        return { ok: true }
      case 'remove-untracked-worktree':
        await removeUntrackedWorktree(deps, repo, args)
        return { ok: true }
      default:
        return { ok: false, error: 'Unknown action.' }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message.slice(0, 500) }
  }
}
