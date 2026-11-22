// Command guards (FORK.md, BAD-686): the checked-out and default branch of a directory, read from
// the .git files (HEAD and refs/remotes/origin/HEAD) so the guard never runs git. Keep electron
// out of this file.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { CommandGuardGit } from '../../../shared/fork/command-guards-rules'

const NONE: CommandGuardGit = { current: null, defaultBranch: null }
const MAX_LEVELS = 40

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8').trim()
  } catch {
    return null
  }
}

/** The `.git` entry at or above `dir`: a folder, or the file a linked worktree has. */
function findDotGit(dir: string): string | null {
  let at = resolve(dir)
  for (let level = 0; level < MAX_LEVELS; level += 1) {
    const candidate = join(at, '.git')
    if (existsSync(candidate)) {
      return candidate
    }
    const parent = dirname(at)
    if (parent === at) {
      return null
    }
    at = parent
  }
  return null
}

/** This worktree's git folder and the one that holds the shared refs. */
function gitDirs(dotGit: string): { gitDir: string; commonDir: string } | null {
  try {
    if (statSync(dotGit).isDirectory()) {
      return { gitDir: dotGit, commonDir: dotGit }
    }
  } catch {
    return null
  }
  const pointer = readText(dotGit)?.match(/^gitdir:\s*(.+)$/)?.[1]
  if (!pointer) {
    return null
  }
  const gitDir = isAbsolute(pointer) ? pointer : resolve(dirname(dotGit), pointer)
  const common = readText(join(gitDir, 'commondir'))
  return { gitDir, commonDir: common ? resolve(gitDir, common) : gitDir }
}

export function readCommandGuardGit(dir: string): CommandGuardGit {
  const dotGit = findDotGit(dir)
  const dirs = dotGit ? gitDirs(dotGit) : null
  if (!dirs) {
    return NONE
  }
  const current = readText(join(dirs.gitDir, 'HEAD'))?.match(/^ref:\s*refs\/heads\/(.+)$/)?.[1]
  const remoteHead = readText(join(dirs.commonDir, 'refs', 'remotes', 'origin', 'HEAD'))?.match(
    /^ref:\s*refs\/remotes\/origin\/(.+)$/
  )?.[1]
  return { current: current ?? null, defaultBranch: remoteHead ?? null }
}
