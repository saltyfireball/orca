// SLRM-2175: projects that are worktrees of one repository share its branches, stashes and
// worktrees. The lost work scan groups them by git common dir and reads the repository once, then
// gives each item to one project, so nothing is listed twice.
import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { GitWorktreeInfo } from '../../../shared/worktree/types'
import { composeWorktreeId } from '../../../shared/worktree/id'
import { mapWorkspaceCleanupWithConcurrency } from '../../ipc/workspace-cleanup/workspace-cleanup-scan-primitives'
import { tryGit, type LostWorkGit } from './lost-work-git'
import type { LostWorkRepo } from './lost-work-scan'

export type LostWorkGroupMember = {
  repo: LostWorkRepo
  /** The project folder with symlinks resolved, as git reports worktree paths. */
  realPath: string
}

export type LostWorkGroup = {
  members: LostWorkGroupMember[]
  /** Position of the group's first project in the scan order. */
  order: number
}

async function realPathOf(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return resolve(path)
  }
}

/** Projects with the same git common dir, in scan order. A project git cannot read stands alone. */
export async function groupLostWorkRepos(
  repos: readonly LostWorkRepo[],
  git: LostWorkGit,
  concurrency: number,
  signal?: AbortSignal
): Promise<LostWorkGroup[]> {
  const located = await mapWorkspaceCleanupWithConcurrency(repos, concurrency, async (repo) => {
    const out = await tryGit(git, ['rev-parse', '--git-common-dir'], { cwd: repo.path, signal })
    const dir = out?.trim()
    return {
      member: { repo, realPath: await realPathOf(repo.path) },
      // Git prints the common dir relative to the folder it ran in.
      commonDir: dir ? await realPathOf(resolve(repo.path, dir)) : null
    }
  })
  const groups: LostWorkGroup[] = []
  const byCommonDir = new Map<string, LostWorkGroup>()
  located.forEach(({ member, commonDir }, order) => {
    const existing = commonDir === null ? undefined : byCommonDir.get(commonDir)
    if (existing) {
      existing.members.push(member)
      return
    }
    const group = { members: [member], order }
    groups.push(group)
    if (commonDir !== null) {
      byCommonDir.set(commonDir, group)
    }
  })
  return groups
}

function samePath(member: LostWorkGroupMember, path: string): boolean {
  return member.repo.path === path || member.realPath === path
}

/**
 * The project that owns the repository's branches and stashes: the one opened at the main
 * checkout, else the first of the group.
 */
export function mainProjectOf(
  group: LostWorkGroup,
  worktrees: readonly GitWorktreeInfo[]
): LostWorkRepo {
  const main = worktrees.find((worktree) => worktree.isMainWorktree)
  const found = main ? group.members.find((member) => samePath(member, main.path)) : undefined
  return (found ?? group.members[0]).repo
}

/**
 * The project a worktree is listed under: the project opened at that folder, else a project Orca
 * keeps the worktree under (so it still reads as tracked), else the main project.
 */
export function worktreeProjectOf(
  group: LostWorkGroup,
  main: LostWorkRepo,
  worktree: GitWorktreeInfo,
  isTracked: (worktreeId: string) => boolean
): LostWorkRepo {
  const atPath = group.members.find((member) => samePath(member, worktree.path))
  if (atPath) {
    return atPath.repo
  }
  const candidates = [main, ...group.members.map((member) => member.repo)]
  return candidates.find((repo) => isTracked(composeWorktreeId(repo.id, worktree.path))) ?? main
}
