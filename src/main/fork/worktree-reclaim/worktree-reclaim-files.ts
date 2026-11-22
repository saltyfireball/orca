// BAD-691 (FORK.md "Worktree reclaim"): the file work for one worktree. Plans which git-ignored
// paths match the reclaim globs, measures them, and deletes them. A path is deleted only when git
// lists it as ignored and untracked, a glob names it, it holds no env file or nested repository,
// and it resolves inside the worktree. Symlinks are never followed or removed.
import { lstat, readdir, realpath, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, sep } from 'node:path'
import type { ForkWorktreeReclaimEntry } from '../../../shared/fork/worktree-reclaim'
import {
  compileReclaimMatcher,
  isProtectedReclaimName
} from '../../../shared/fork/worktree-reclaim-glob'

export type ReclaimGit = (
  args: string[],
  options: { cwd: string; signal?: AbortSignal }
) => Promise<string>

type Measured =
  | { ok: true; bytes: number }
  | { ok: false; reason: NonNullable<ForkWorktreeReclaimEntry['skipped']> }

/** Ignored, untracked paths git sees under `root`; a folder ends with `/` and is listed whole. */
export async function listIgnoredPaths(
  git: ReclaimGit,
  root: string,
  signal?: AbortSignal
): Promise<string[]> {
  const out = await git(
    ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'],
    { cwd: root, signal }
  )
  return out.split('\0').filter((entry) => entry.length > 0)
}

function isInsideWorktree(relative: string): boolean {
  if (!relative || isAbsolute(relative) || /^[a-zA-Z]:/.test(relative)) {
    return false
  }
  const segments = relative.replace(/\/+$/, '').split('/')
  return !segments.some(
    (segment) => segment === '' || segment === '.' || segment === '..' || segment === '.git'
  )
}

async function measure(path: string, signal?: AbortSignal): Promise<Measured> {
  let bytes = 0
  const pending = [path]
  while (pending.length > 0) {
    if (signal?.aborted) {
      throw signal.reason ?? new Error('aborted')
    }
    const current = pending.pop() as string
    const info = await lstat(current)
    if (info.isSymbolicLink()) {
      if (current === path) {
        return { ok: false, reason: 'symlink' }
      }
      continue
    }
    if (!info.isDirectory()) {
      bytes += process.platform === 'win32' ? info.size : info.blocks * 512
      continue
    }
    for (const child of await readdir(current, { withFileTypes: true })) {
      if (child.name === '.git') {
        return { ok: false, reason: 'holds-git-folder' }
      }
      if (isProtectedReclaimName(child.name)) {
        return { ok: false, reason: 'holds-env-file' }
      }
      pending.push(join(current, child.name))
    }
  }
  return { ok: true, bytes }
}

/** The ignored paths the globs name, each measured, in path order. Reads only; deletes nothing. */
export async function planWorktreeReclaim(options: {
  git: ReclaimGit
  root: string
  globs: readonly string[]
  signal?: AbortSignal
}): Promise<ForkWorktreeReclaimEntry[]> {
  const matches = compileReclaimMatcher(options.globs)
  const wanted = (await listIgnoredPaths(options.git, options.root, options.signal))
    .filter((entry) => isInsideWorktree(entry) && matches(entry))
    .sort()
  const entries: ForkWorktreeReclaimEntry[] = []
  for (const entry of wanted) {
    const path = entry.replace(/\/+$/, '')
    try {
      const measured = await measure(join(options.root, path), options.signal)
      entries.push(
        measured.ok ? { path, bytes: measured.bytes } : { path, bytes: 0, skipped: measured.reason }
      )
    } catch (error) {
      if (options.signal?.aborted) {
        throw error
      }
      // A path that vanished or cannot be read is left alone.
      entries.push({ path, bytes: 0, skipped: 'error' })
    }
  }
  return entries
}

/** Deletes the planned entries that were not skipped. Marks each `removed` or `skipped`. */
export async function applyWorktreeReclaim(
  root: string,
  planned: readonly ForkWorktreeReclaimEntry[],
  signal?: AbortSignal
): Promise<ForkWorktreeReclaimEntry[]> {
  const realRoot = await realpath(root)
  const result: ForkWorktreeReclaimEntry[] = []
  for (const entry of planned) {
    if (entry.skipped) {
      result.push(entry)
      continue
    }
    if (signal?.aborted) {
      throw signal.reason ?? new Error('aborted')
    }
    result.push(await removeEntry(root, realRoot, entry))
  }
  return result
}

async function removeEntry(
  root: string,
  realRoot: string,
  entry: ForkWorktreeReclaimEntry
): Promise<ForkWorktreeReclaimEntry> {
  if (!isInsideWorktree(entry.path)) {
    return { ...entry, bytes: 0, skipped: 'outside-worktree' }
  }
  const target = join(root, entry.path)
  try {
    // The parent must resolve inside the worktree, so a symlinked folder cannot lead out of it.
    const realParent = await realpath(dirname(target))
    if (realParent !== realRoot && !realParent.startsWith(realRoot + sep)) {
      return { ...entry, bytes: 0, skipped: 'outside-worktree' }
    }
    if ((await lstat(target)).isSymbolicLink()) {
      return { ...entry, bytes: 0, skipped: 'symlink' }
    }
    // rm never follows a symlink it meets inside the folder; it removes the link.
    await rm(target, { recursive: true, force: false })
    return { ...entry, removed: true }
  } catch {
    return { ...entry, bytes: 0, skipped: 'error' }
  }
}
