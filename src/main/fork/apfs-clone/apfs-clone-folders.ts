// SLRM-2270 (FORK.md): clone heavy git-ignored folders (node_modules by default) from the
// project's own checkout into a new worktree with APFS copy-on-write, so its setup script finds
// them in place and an install has little or nothing to do. A folder is cloned only when it is a
// real folder inside the project, the new worktree has nothing at that path, Git ignores the path
// there, and both are on one volume. Nothing here ever fails a create: problems are logged.
//
// Relative symlinks that leave the folder (pnpm links node_modules into a store as
// `../../../Library/pnpm/...`) only work when the worktree sits at the same depth as the
// project; otherwise the folder is skipped and the setup script installs as before.
import { lstat, readdir, readlink, realpath, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { forkApfsCloneFolders } from '../../../shared/fork/apfs-clone'
import { readForkApfsCloneSettings } from './apfs-clone-settings-reader'
import { defaultForkApfsCloneIo, exitCode, sameVolume, type ForkApfsCloneIo } from './apfs-clone-io'

type FolderOptions = { wslDistro?: string; signal?: AbortSignal }

function inside(root: string, path: string): boolean {
  return path.startsWith(root.endsWith(sep) ? root : root + sep)
}

async function absent(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return false
  } catch (error) {
    return exitCode(error) === 'ENOENT'
  }
}

async function isIgnored(
  worktreePath: string,
  folder: string,
  io: ForkApfsCloneIo
): Promise<boolean> {
  try {
    // The trailing slash asks about a folder, so `node_modules/` patterns match before it exists.
    await io.git(['check-ignore', '-q', '--', `${folder}/`], worktreePath)
    return true
  } catch (error) {
    if (exitCode(error) === 1) {
      return false
    }
    throw error
  }
}

/** Most entries looked at for links leaving the folder; a bigger folder is checked in part. */
const MAX_LINK_SCAN = 5000

/**
 * True when a relative link near the top of `source` (its entries, and one level into folders
 * such as npm `@scope` ones) leaves the folder and would point somewhere else from `target`.
 */
async function hasMovingLinks(source: string, target: string): Promise<boolean> {
  let scanned = 0
  const scan = async (dir: string, depth: number): Promise<boolean> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (++scanned > MAX_LINK_SCAN) {
        return false
      }
      const path = join(dir, entry.name)
      if (entry.isSymbolicLink()) {
        const link = await readlink(path)
        const from = dirname(path)
        const resolved = resolve(from, link)
        if (!isAbsolute(link) && !inside(source, resolved)) {
          const moved = resolve(join(target, from.slice(source.length)), link)
          if (moved !== resolved) {
            return true
          }
        }
      } else if (entry.isDirectory() && depth === 0 && entry.name.startsWith('@')) {
        if (await scan(path, 1)) {
          return true
        }
      }
    }
    return false
  }
  return scan(source, 0)
}

/** Clone one folder; returns why it was skipped, or 'cloned'. */
async function cloneFolder(
  repoRoot: string,
  worktreeRoot: string,
  folder: string,
  io: ForkApfsCloneIo
): Promise<string> {
  const source = join(repoRoot, folder)
  const target = join(worktreeRoot, folder)
  let sourceInfo
  try {
    sourceInfo = await lstat(source)
  } catch {
    return 'no source'
  }
  if (!sourceInfo.isDirectory()) {
    return 'source is not a folder'
  }
  // A symlinked parent could point the source outside the project.
  if (!inside(repoRoot, await realpath(source))) {
    return 'source outside the project'
  }
  if (!(await absent(target))) {
    return 'target exists'
  }
  const targetParent = dirname(target)
  let parentReal: string
  try {
    parentReal = await realpath(targetParent)
  } catch {
    return 'no target parent'
  }
  if (parentReal !== worktreeRoot && !inside(worktreeRoot, parentReal)) {
    return 'target outside the worktree'
  }
  if (!(await isIgnored(worktreeRoot, folder, io))) {
    return 'not ignored'
  }
  if (!(await sameVolume(source, parentReal))) {
    return 'different volume'
  }
  // The resolved parent, so a parent swapped for a link after the checks cannot redirect it.
  const realTarget = join(parentReal, basename(target))
  if (await hasMovingLinks(source, realTarget)) {
    return 'relative links leave the folder'
  }
  try {
    await io.cloneDir(source, realTarget)
  } catch (error) {
    // The target was absent before; remove a partial copy so setup sees a clean slate.
    await rm(realTarget, { recursive: true, force: true })
    throw error
  }
  return 'cloned'
}

/** Clone the configured folders into a worktree created a moment ago. Never throws. */
export async function forkCloneIgnoredFolders(
  repoPath: string,
  worktreePath: string,
  options: FolderOptions = {},
  io: ForkApfsCloneIo = defaultForkApfsCloneIo(options.signal)
): Promise<Record<string, string>> {
  const outcome: Record<string, string> = {}
  if (io.platform !== 'darwin' || options.wslDistro) {
    return outcome
  }
  const settings = readForkApfsCloneSettings()
  const folders = settings ? forkApfsCloneFolders(settings) : []
  if (folders.length === 0) {
    return outcome
  }
  let repoRoot: string
  let worktreeRoot: string
  try {
    ;[repoRoot, worktreeRoot] = await Promise.all([realpath(repoPath), realpath(worktreePath)])
  } catch {
    return outcome
  }
  if (repoRoot === worktreeRoot) {
    return outcome
  }
  for (const folder of folders) {
    try {
      outcome[folder] = await cloneFolder(repoRoot, worktreeRoot, folder, io)
    } catch (error) {
      outcome[folder] = 'failed'
      console.warn(`[fork apfs-clone] could not clone ${folder} into ${worktreePath}`, error)
    }
  }
  return outcome
}
