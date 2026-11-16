// SLRM-2270 (FORK.md): fill a new worktree from a cached checkout with APFS clones.
//
// Idea from T3 Code's "Fast worktree checkout" (MIT). The project keeps one plain checkout of
// tracked files in `<git common dir>/blackfish-clone-cache/tree`, with its own index file. A new
// worktree is added with `--no-checkout`; the cache is moved to the new worktree's commit with a
// two-tree `read-tree -m -u` (only changed files are written), the whole tree is cloned with one
// clonefile(2) call into a staging folder next to it, its entries are moved into the worktree,
// and the cache's index is copied in. Worktree and index then hold exactly HEAD; Git refreshes
// the index's file stats on the first `git status`. Anything unexpected falls back to
// `git reset --hard HEAD` on the empty worktree, a plain full checkout, so the worktree always
// ends up as `git worktree add` would leave it.
//
// Only on macOS, never for WSL, sparse checkouts, repositories with a post-checkout hook (it
// would not run), or when a Git filter could apply (Git LFS and the like): a `filter=` in the
// commit's .gitattributes or any `filter.*` entry in Git config.
import { constants } from 'node:fs'
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { isAbsolute, join, resolve } from 'node:path'
import { forkApfsCloneCheckoutEnabled } from '../../../shared/fork/apfs-clone'
import { readForkApfsCloneSettings } from './apfs-clone-settings-reader'
import { defaultForkApfsCloneIo, exitCode, sameVolume, type ForkApfsCloneIo } from './apfs-clone-io'

export const FORK_APFS_CACHE_DIR = 'blackfish-clone-cache'
/** A lock older than this is from a crashed create and is taken over. */
const STALE_LOCK_MS = 15 * 60_000
const OID = /^[0-9a-f]{40}([0-9a-f]{24})?$/

export type ForkApfsCheckoutPlan = {
  /** Fill the worktree `git worktree add --no-checkout` just made. Throws only if the plain
   *  checkout fallback itself fails, as a failed `git worktree add` checkout would. */
  populate: (worktreePath: string) => Promise<'cloned' | 'plain'>
}

type PlanOptions = { wslDistro?: string; signal?: AbortSignal }

/**
 * Decide before `git worktree add` whether this create clones. Null keeps the stock checkout.
 * Never throws: any failed probe is a plain null.
 */
export async function planForkApfsCheckout(
  repoPath: string,
  options: PlanOptions,
  io: ForkApfsCloneIo = defaultForkApfsCloneIo(options.signal)
): Promise<ForkApfsCheckoutPlan | null> {
  if (io.platform !== 'darwin' || options.wslDistro) {
    return null
  }
  const settings = readForkApfsCloneSettings()
  if (!settings || !forkApfsCloneCheckoutEnabled(settings)) {
    return null
  }
  try {
    if (await usesSparseCheckout(repoPath, io)) {
      return null
    }
    const hooksDir = (await io.git(['rev-parse', '--git-path', 'hooks'], repoPath)).trim()
    const hooksPath = isAbsolute(hooksDir) ? hooksDir : resolve(repoPath, hooksDir)
    if (await exists(join(hooksPath, 'post-checkout'))) {
      return null
    }
    const commonDir = (
      await io.git(['rev-parse', '--path-format=absolute', '--git-common-dir'], repoPath)
    ).trim()
    if (!isAbsolute(commonDir)) {
      return null
    }
    return { populate: (worktreePath) => populate(repoPath, commonDir, worktreePath, io) }
  } catch {
    return null
  }
}

async function usesSparseCheckout(repoPath: string, io: ForkApfsCloneIo): Promise<boolean> {
  try {
    const value = await io.git(['config', '--bool', '--get', 'core.sparseCheckout'], repoPath)
    return value.trim() === 'true'
  } catch (error) {
    if (exitCode(error) === 1) {
      return false
    }
    throw error
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch {
    return false
  }
}

async function populate(
  repoPath: string,
  commonDir: string,
  worktreePath: string,
  io: ForkApfsCloneIo
): Promise<'cloned' | 'plain'> {
  let cloneStarted = false
  try {
    const done = await cloneFromCache(repoPath, commonDir, worktreePath, io, () => {
      cloneStarted = true
    })
    if (done) {
      return 'cloned'
    }
  } catch (error) {
    console.warn('[fork apfs-clone] clone failed, using a plain checkout', error)
    if (cloneStarted) {
      await clearWorktreeFiles(worktreePath)
    }
  }
  await plainCheckout(worktreePath, io)
  return 'plain'
}

/** Makes worktree and index exactly HEAD: a full checkout on an empty worktree. */
async function plainCheckout(worktreePath: string, io: ForkApfsCloneIo): Promise<void> {
  await io.git(['reset', '-q', '--hard', 'HEAD'], worktreePath, { long: true })
}

/** Everything but the `.git` file of a worktree this create made a moment ago. */
async function clearWorktreeFiles(worktreePath: string): Promise<void> {
  const entries = await readdir(worktreePath)
  await Promise.all(
    entries
      .filter((name) => name !== '.git')
      .map((name) => rm(join(worktreePath, name), { recursive: true, force: true }))
  )
}

async function cloneFromCache(
  repoPath: string,
  commonDir: string,
  worktreePath: string,
  io: ForkApfsCloneIo,
  onCloneStart: () => void
): Promise<boolean> {
  // Only a worktree holding nothing but its .git file is filled; anything else is not ours.
  const entries = await readdir(worktreePath)
  if (entries.some((name) => name !== '.git')) {
    return false
  }
  const target = (await io.git(['rev-parse', 'HEAD'], worktreePath)).trim()
  if (!OID.test(target) || (await usesFilters(repoPath, target, io))) {
    return false
  }
  const cacheDir = join(commonDir, FORK_APFS_CACHE_DIR)
  await mkdir(cacheDir, { recursive: true })
  if (!(await sameVolume(cacheDir, worktreePath))) {
    return false
  }
  const release = await takeLock(join(cacheDir, 'lock'))
  if (!release) {
    return false
  }
  try {
    const tree = join(cacheDir, 'tree')
    const index = join(cacheDir, 'index')
    await updateCache(commonDir, cacheDir, tree, index, target, io)
    const worktreeIndex = (
      await io.git(['rev-parse', '--path-format=absolute', '--git-path', 'index'], worktreePath)
    ).trim()
    if (!isAbsolute(worktreeIndex)) {
      return false
    }
    await removeStaleStages(cacheDir)
    const stage = join(cacheDir, `stage-${randomBytes(6).toString('hex')}`)
    try {
      await io.cloneDir(tree, stage)
      onCloneStart()
      // Same volume (checked above), so each move is a rename, not a copy.
      for (const name of await readdir(stage)) {
        await rename(join(stage, name), join(worktreePath, name))
      }
    } finally {
      await rm(stage, { recursive: true, force: true })
    }
    await copyFile(index, worktreeIndex)
    return true
  } finally {
    await release()
  }
}

/** Staging folders left by a create that crashed mid-clone; only ever removed under the lock. */
async function removeStaleStages(cacheDir: string): Promise<void> {
  for (const name of await readdir(cacheDir)) {
    if (name.startsWith('stage-')) {
      await rm(join(cacheDir, name), { recursive: true, force: true })
    }
  }
}

/** True when the commit's .gitattributes name a filter (Git LFS and the like), or Git config
 *  defines any filter (one could be applied from info/attributes or global attributes). */
async function usesFilters(repoPath: string, oid: string, io: ForkApfsCloneIo): Promise<boolean> {
  try {
    await io.git(['config', '--get-regexp', '^filter\\.'], repoPath)
    return true
  } catch (error) {
    if (exitCode(error) !== 1) {
      throw error
    }
  }
  try {
    await io.git(['grep', '-q', '-e', 'filter=', oid, '--', '*.gitattributes'], repoPath)
    return true
  } catch (error) {
    if (exitCode(error) === 1) {
      return false
    }
    throw error
  }
}

async function takeLock(lockPath: string): Promise<(() => Promise<void>) | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY)
      await handle.writeFile(String(process.pid))
      await handle.close()
      return async () => {
        await unlink(lockPath).catch(() => undefined)
      }
    } catch (error) {
      if (exitCode(error) !== 'EEXIST' || attempt > 0) {
        return null
      }
      // Another create holds the cache: that one clones, this one checks out plainly.
      const age = Date.now() - (await stat(lockPath)).mtimeMs
      if (age < STALE_LOCK_MS) {
        return null
      }
      // Only one create wins the rename, so two never take over the same stale lock.
      const stale = `${lockPath}.stale-${randomBytes(6).toString('hex')}`
      try {
        await rename(lockPath, stale)
      } catch {
        return null
      }
      await unlink(stale).catch(() => undefined)
    }
  }
  return null
}

async function updateCache(
  commonDir: string,
  cacheDir: string,
  tree: string,
  index: string,
  target: string,
  io: ForkApfsCloneIo
): Promise<void> {
  const headFile = join(cacheDir, 'head')
  const cacheGit = (args: string[]): Promise<string> =>
    io.git(['--git-dir', commonDir, '--work-tree', tree, ...args], tree, {
      env: { ...process.env, GIT_INDEX_FILE: index },
      long: true
    })
  const current = (await readFile(headFile, 'utf8').catch(() => '')).trim()
  if (OID.test(current) && (await exists(tree)) && (await exists(index))) {
    try {
      if (current === target) {
        // Cheap when untouched (stats match); exits 1 if any cached file was changed.
        await cacheGit(['update-index', '--refresh'])
        return
      }
      // Two-tree fast-forward: writes only the files that differ between the commits.
      await cacheGit(['read-tree', '-m', '-u', current, target])
      await writeFile(headFile, target)
      return
    } catch (error) {
      console.warn('[fork apfs-clone] cache out of date, rebuilding it', error)
    }
  }
  await rm(headFile, { force: true })
  await rm(index, { force: true })
  await rm(tree, { recursive: true, force: true })
  await mkdir(tree, { recursive: true })
  await cacheGit(['read-tree', target])
  // -u records file stats, so the next read-tree -m -u sees the cache as up to date.
  await cacheGit(['checkout-index', '-a', '-f', '-u'])
  await writeFile(headFile, target)
}

/**
 * The one hook in `addWorktree`: when this create clones, add with `--no-checkout` and fill the
 * worktree afterwards; otherwise run the add unchanged.
 */
export async function withForkApfsCheckout<T>(
  repoPath: string,
  worktreePath: string,
  noCheckout: boolean,
  options: PlanOptions,
  add: (noCheckout: boolean) => Promise<T>
): Promise<T> {
  const plan = noCheckout ? null : await planForkApfsCheckout(repoPath, options)
  const result = await add(noCheckout || plan !== null)
  await plan?.populate(worktreePath)
  return result
}
