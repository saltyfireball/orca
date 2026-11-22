// BAD-678 (FORK.md "Turn checkpoints"): what one checkpoint holds, as a file list and a patch.
import type { ForkTurnCheckpointFile } from '../../../shared/fork/turn-checkpoints'
import {
  EMPTY_TREE,
  MAX_PATCH_CHARS,
  inShadow,
  stageWorkTree,
  type CheckpointGit,
  type Shadow,
  type StoredCheckpoint
} from './turn-checkpoint-shadow'
import { listCheckpoints, treeDiff } from './turn-checkpoint-store'

/** Paths a merge, pull, checkout, rebase or reset brought into the project between two heads. */
async function pulledInPaths(
  git: CheckpointGit,
  workTree: string,
  prevHead: string,
  head: string
): Promise<Set<string>> {
  const paths = new Set<string>()
  if (prevHead === head) {
    return paths
  }
  let log: string
  try {
    log = await git(['log', '-g', '-n', '300', '--format=%H%x1f%gs', 'HEAD'], { cwd: workTree })
  } catch {
    return paths
  }
  const entries = log
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha = '', subject = ''] = line.split('\x1f')
      return { sha, subject }
    })
  const stop = entries.findIndex((entry) => entry.sha === prevHead)
  if (stop === -1) {
    return paths
  }
  for (let index = 0; index < stop; index += 1) {
    const entry = entries[index]
    const before = entries[index + 1]
    if (
      !entry ||
      !before ||
      !/^(merge|pull|checkout|rebase|reset|cherry-pick|commit \(merge\))/.test(entry.subject)
    ) {
      continue
    }
    try {
      const names = await git(
        ['diff', '--name-only', '-z', '--no-renames', before.sha, entry.sha],
        {
          cwd: workTree
        }
      )
      for (const name of names.split('\0')) {
        if (name) {
          paths.add(name)
        }
      }
    } catch {
      // A commit the project has since pruned: nothing to exclude from it.
    }
  }
  return paths
}

export type CheckpointDiff = {
  checkpoint: StoredCheckpoint
  against: 'previous' | 'now'
  files: ForkTurnCheckpointFile[]
  excludedMergedFiles: number
  patch: string | null
  patchTruncated: boolean
  note: string | null
}

/**
 * What one checkpoint holds: the turn's changes against the checkpoint before it (files a merge,
 * pull or checkout brought in are left out), or, with `now`, how the files differ from it today.
 */
export async function diffCheckpoint(
  git: CheckpointGit,
  shadow: Shadow,
  id: string,
  options: { now: boolean; patch: boolean; maxFileBytes: number }
): Promise<CheckpointDiff> {
  const all = await listCheckpoints(git, shadow)
  const checkpoint = all.find((item) => item.id === id)
  if (!checkpoint) {
    throw new Error(`No checkpoint ${id}.`)
  }
  let from: string
  let to: string
  let note: string | null = null
  let prev: StoredCheckpoint | undefined
  if (options.now) {
    from = checkpoint.tree
    to = await stageWorkTree(git, shadow, options.maxFileBytes)
  } else {
    prev = checkpoint.prev ? all.find((item) => item.id === checkpoint.prev) : undefined
    if (checkpoint.prev && !prev) {
      note = 'The checkpoint before this one was pruned, so its changes cannot be listed.'
    }
    from = prev?.tree ?? (checkpoint.prev ? checkpoint.tree : EMPTY_TREE)
    to = checkpoint.tree
  }
  let files = (await treeDiff(git, shadow, from, to)).map((file) => ({ ...file }))
  let excluded = 0
  if (prev && prev.head && checkpoint.head && prev.head !== checkpoint.head) {
    const pulled = await pulledInPaths(git, shadow.workTree, prev.head, checkpoint.head)
    if (pulled.size > 0) {
      const candidates = files.filter((file) => pulled.has(file.path) && !file.path.includes('\n'))
      const known = await headBlobs(
        git,
        shadow.workTree,
        checkpoint.head,
        candidates.map((f) => f.path)
      )
      const merged = new Set(
        candidates
          .filter((file) =>
            file.status === 'D'
              ? known.get(file.path) === null
              : known.get(file.path) === file.newSha
          )
          .map((file) => file.path)
      )
      excluded = merged.size
      files = files.filter((file) => !merged.has(file.path))
    }
  }
  let patch: string | null = null
  let patchTruncated = false
  if (options.patch && files.length > 0 && excluded === 0) {
    const text = await inShadow(git, shadow, [
      'diff-tree',
      '-p',
      '-r',
      '--no-renames',
      '--no-color',
      '--no-ext-diff',
      from,
      to
    ])
    patchTruncated = text.length > MAX_PATCH_CHARS
    patch = patchTruncated ? text.slice(0, MAX_PATCH_CHARS) : text
  } else if (options.patch && files.length > 0) {
    const text = await inShadow(git, shadow, [
      'diff-tree',
      '-p',
      '-r',
      '--no-renames',
      '--no-color',
      '--no-ext-diff',
      from,
      to,
      '--',
      ...files.map((file) => `:(literal)${file.path}`)
    ])
    patchTruncated = text.length > MAX_PATCH_CHARS
    patch = patchTruncated ? text.slice(0, MAX_PATCH_CHARS) : text
  }
  return {
    checkpoint,
    against: options.now ? 'now' : 'previous',
    files: files.map(({ path, status }) => ({ path, status })),
    excludedMergedFiles: excluded,
    patch,
    patchTruncated,
    note
  }
}

/** The blob each path has at the project's `head`; null for a path missing there. */
async function headBlobs(
  git: CheckpointGit,
  workTree: string,
  head: string,
  paths: string[]
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>()
  if (paths.length === 0) {
    return result
  }
  try {
    const out = await git(['cat-file', '--batch-check'], {
      cwd: workTree,
      stdin: `${paths.map((path) => `${head}:${path}`).join('\n')}\n`
    })
    const lines = out.split('\n')
    paths.forEach((path, index) => {
      const line = lines[index] ?? ''
      result.set(path, line.endsWith(' missing') ? null : (line.split(' ')[0] ?? null))
    })
  } catch {
    // The project cannot answer: nothing is treated as pulled in.
  }
  return result
}
