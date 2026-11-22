// BAD-678 (FORK.md "Turn checkpoints"): putting the working tree back to a checkpoint.
import { lstat, rm, rmdir } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import {
  inShadow,
  inTree,
  type CheckpointGit,
  type CheckpointOrigin,
  type Shadow,
  type StoredCheckpoint
} from './turn-checkpoint-shadow'
import { captureCheckpoint, listCheckpoints, treeDiff } from './turn-checkpoint-store'

function isSafeRelative(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    path.split('/').every((part) => part !== '' && part !== '.' && part !== '..' && part !== '.git')
  )
}

/** Removes one file of the working tree, refusing a path that runs through a symlinked folder. */
async function removeTreeFile(workTree: string, path: string): Promise<string | null> {
  if (!isSafeRelative(path)) {
    return null
  }
  const parts = path.split('/')
  let current = workTree
  for (const part of parts.slice(0, -1)) {
    current = join(current, part)
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        return null
      }
    } catch {
      return null
    }
  }
  const full = join(current, parts.at(-1) ?? '')
  if (!resolve(full).startsWith(`${resolve(workTree)}${sep}`)) {
    return null
  }
  await rm(full, { force: true }).catch(() => undefined)
  return dirname(full)
}

async function pruneEmptyDirs(workTree: string, dirs: Set<string>): Promise<void> {
  const root = resolve(workTree)
  const ordered = [...dirs].sort((a, b) => b.length - a.length)
  for (const start of ordered) {
    let current = resolve(start)
    while (current.startsWith(`${root}${sep}`)) {
      try {
        await rmdir(current)
      } catch {
        break
      }
      current = dirname(current)
    }
  }
}

export type RestoreOutcome = {
  target: StoredCheckpoint
  pre: StoredCheckpoint
  preCreated: boolean
  restore: StoredCheckpoint | null
  changedFiles: number
}

/**
 * Puts the working tree back to `id`: files the checkpoint lacks are deleted, the rest are written
 * back. A checkpoint of the files as they are comes first (so the restore can be undone), and one
 * of the restored state after. Ignored files and files over the size cap are never touched.
 */
export async function restoreCheckpoint(
  git: CheckpointGit,
  shadow: Shadow,
  id: string,
  options: { now: number; maxFileBytes: number; origin?: CheckpointOrigin }
): Promise<RestoreOutcome> {
  const target = (await listCheckpoints(git, shadow)).find((item) => item.id === id)
  if (!target) {
    throw new Error(`No checkpoint ${id}.`)
  }
  const { checkpoint: pre, created: preCreated } = await captureCheckpoint(git, shadow, {
    kind: 'pre-restore',
    now: options.now,
    maxFileBytes: options.maxFileBytes,
    dedupe: true,
    origin: options.origin
  })
  const changes = await treeDiff(git, shadow, pre.tree, target.tree)
  if (changes.length === 0) {
    return { target, pre, preCreated, restore: null, changedFiles: 0 }
  }
  const touchedDirs = new Set<string>()
  for (const change of changes.filter((item) => item.status === 'D')) {
    const dir = await removeTreeFile(shadow.workTree, change.path)
    if (dir) {
      touchedDirs.add(dir)
    }
  }
  await pruneEmptyDirs(shadow.workTree, touchedDirs)
  const writes = changes.filter((item) => item.status !== 'D').map((item) => item.path)
  await inShadow(git, shadow, ['read-tree', target.tree])
  if (writes.length > 0) {
    await inTree(git, shadow, ['checkout-index', '-f', '-z', '--stdin'], {
      stdin: `${writes.join('\0')}\0`
    })
  }
  const restored = await captureCheckpoint(git, shadow, {
    kind: 'restore',
    now: options.now + 1,
    maxFileBytes: options.maxFileBytes,
    dedupe: true,
    origin: { ...options.origin, restoredFrom: target.id, undoTo: pre.id }
  })
  return {
    target,
    pre,
    preCreated,
    restore: restored.created ? restored.checkpoint : null,
    changedFiles: changes.length
  }
}
