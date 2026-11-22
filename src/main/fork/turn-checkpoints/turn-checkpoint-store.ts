// BAD-678 (FORK.md "Turn checkpoints"): the checkpoint commits of a shadow store: read them back,
// make a new one from the working tree, and prune old ones.
import { join } from 'node:path'
import {
  FORK_TURN_CHECKPOINT_REF_PREFIX,
  type ForkTurnCheckpoint,
  type ForkTurnCheckpointFile,
  type ForkTurnCheckpointKind
} from '../../../shared/fork/turn-checkpoints'
import {
  EMPTY_TREE,
  MAX_PROMPT_CHARS,
  inShadow,
  pathExists,
  stageWorkTree,
  type CheckpointGit,
  type CheckpointOrigin,
  type Meta,
  type Shadow,
  type StoredCheckpoint
} from './turn-checkpoint-shadow'

function parseMeta(text: string): Meta | null {
  const start = text.indexOf('{')
  if (start === -1) {
    return null
  }
  try {
    const value: unknown = JSON.parse(text.slice(start))
    if (typeof value !== 'object' || value === null) {
      return null
    }
    const meta = value as Partial<Meta>
    if (
      typeof meta.createdAt !== 'number' ||
      !['baseline', 'turn', 'pre-restore', 'restore'].includes(String(meta.kind))
    ) {
      return null
    }
    return {
      kind: meta.kind as ForkTurnCheckpointKind,
      createdAt: meta.createdAt,
      files: typeof meta.files === 'number' ? meta.files : 0,
      prev: typeof meta.prev === 'string' ? meta.prev : null,
      head: typeof meta.head === 'string' ? meta.head : null,
      ...(typeof meta.sessionId === 'string' ? { sessionId: meta.sessionId } : {}),
      ...(typeof meta.agent === 'string' ? { agent: meta.agent } : {}),
      ...(typeof meta.prompt === 'string' ? { prompt: meta.prompt } : {}),
      ...(typeof meta.restoredFrom === 'string' ? { restoredFrom: meta.restoredFrom } : {}),
      ...(typeof meta.undoTo === 'string' ? { undoTo: meta.undoTo } : {})
    }
  } catch {
    return null
  }
}

/** Every checkpoint of the shadow store, oldest first. Empty when the store does not exist yet. */
export async function listCheckpoints(
  git: CheckpointGit,
  shadow: Shadow
): Promise<StoredCheckpoint[]> {
  if (!(await pathExists(join(shadow.gitDir, 'HEAD')))) {
    return []
  }
  const out = await inShadow(git, shadow, [
    'for-each-ref',
    '--sort=refname',
    '--format=%(refname)%1f%(objectname)%1f%(tree)%1f%(contents)%1e',
    FORK_TURN_CHECKPOINT_REF_PREFIX
  ])
  const result: StoredCheckpoint[] = []
  for (const record of out.split('\x1e')) {
    const [ref, commit, tree, contents] = record.replace(/^\n/, '').split('\x1f')
    if (!ref || !commit || !tree) {
      continue
    }
    const meta = parseMeta(contents ?? '')
    if (!meta) {
      continue
    }
    result.push({
      id: ref.slice(FORK_TURN_CHECKPOINT_REF_PREFIX.length),
      kind: meta.kind,
      createdAt: meta.createdAt,
      files: meta.files,
      sessionId: meta.sessionId ?? null,
      agent: meta.agent ?? null,
      prompt: meta.prompt ?? null,
      restoredFrom: meta.restoredFrom ?? null,
      undoTo: meta.undoTo ?? null,
      commit,
      tree,
      prev: meta.prev,
      head: meta.head
    })
  }
  return result
}

export function publicCheckpoint(checkpoint: StoredCheckpoint): ForkTurnCheckpoint {
  return {
    id: checkpoint.id,
    kind: checkpoint.kind,
    createdAt: checkpoint.createdAt,
    files: checkpoint.files,
    sessionId: checkpoint.sessionId,
    agent: checkpoint.agent,
    prompt: checkpoint.prompt,
    restoredFrom: checkpoint.restoredFrom,
    undoTo: checkpoint.undoTo
  }
}

/** Parses `diff-tree --raw -z --no-abbrev` output. */
function parseRaw(out: string): (ForkTurnCheckpointFile & { oldSha: string; newSha: string })[] {
  const tokens = out.split('\0')
  const files: (ForkTurnCheckpointFile & { oldSha: string; newSha: string })[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    const header = tokens[index]
    if (!header?.startsWith(':')) {
      continue
    }
    const fields = header.slice(1).split(' ')
    const letter = fields[4]?.[0]
    const path = tokens[index + 1]
    index += 1
    if (!path || (letter !== 'A' && letter !== 'M' && letter !== 'D' && letter !== 'T')) {
      continue
    }
    files.push({ path, status: letter, oldSha: fields[2] ?? '', newSha: fields[3] ?? '' })
  }
  return files
}

export async function treeDiff(
  git: CheckpointGit,
  shadow: Shadow,
  from: string,
  to: string
): Promise<(ForkTurnCheckpointFile & { oldSha: string; newSha: string })[]> {
  return parseRaw(
    await inShadow(git, shadow, [
      'diff-tree',
      '-r',
      '-z',
      '--raw',
      '--no-renames',
      '--no-abbrev',
      from,
      to
    ])
  )
}

export async function projectHead(git: CheckpointGit, workTree: string): Promise<string | null> {
  try {
    const out = await git(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], { cwd: workTree })
    return out.trim() || null
  } catch {
    return null
  }
}

async function newRef(git: CheckpointGit, shadow: Shadow, now: number): Promise<string> {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const id = attempt === 0 ? String(now) : `${now}-${attempt}`
    const taken = await inShadow(git, shadow, [
      'rev-parse',
      '--verify',
      '--quiet',
      `${FORK_TURN_CHECKPOINT_REF_PREFIX}${id}`
    ]).catch(() => '')
    if (!taken.trim()) {
      return id
    }
  }
  throw new Error('Could not pick a free checkpoint name.')
}

export type CaptureOptions = {
  kind: ForkTurnCheckpointKind
  now: number
  maxFileBytes: number
  origin?: CheckpointOrigin
  /** Take no new checkpoint when the files equal the newest one's (the newest is returned). */
  dedupe: boolean
}

/**
 * Snapshots the working tree. With `dedupe`, resolves the newest checkpoint instead of making a
 * second one for the same files; `created` says which happened.
 */
export async function captureCheckpoint(
  git: CheckpointGit,
  shadow: Shadow,
  options: CaptureOptions
): Promise<{ checkpoint: StoredCheckpoint; created: boolean }> {
  const tree = await stageWorkTree(git, shadow, options.maxFileBytes)
  const existing = await listCheckpoints(git, shadow)
  const tip = existing.at(-1) ?? null
  if (options.dedupe && tip && tip.tree === tree) {
    return { checkpoint: tip, created: false }
  }
  const files = (await treeDiff(git, shadow, tip?.tree ?? EMPTY_TREE, tree)).length
  const head = await projectHead(git, shadow.workTree)
  const origin = options.origin ?? {}
  const meta: Meta = {
    kind: options.kind,
    createdAt: options.now,
    files,
    prev: tip?.id ?? null,
    head,
    ...(origin.sessionId ? { sessionId: origin.sessionId } : {}),
    ...(origin.agent ? { agent: origin.agent } : {}),
    ...(origin.prompt ? { prompt: origin.prompt.slice(0, MAX_PROMPT_CHARS) } : {}),
    ...(origin.restoredFrom ? { restoredFrom: origin.restoredFrom } : {}),
    ...(origin.undoTo ? { undoTo: origin.undoTo } : {})
  }
  const commit = (
    await inShadow(git, shadow, ['commit-tree', tree], {
      stdin: `orca checkpoint\n\n${JSON.stringify(meta)}\n`
    })
  ).trim()
  const id = await newRef(git, shadow, options.now)
  await inShadow(git, shadow, ['update-ref', `${FORK_TURN_CHECKPOINT_REF_PREFIX}${id}`, commit])
  const checkpoint = (await listCheckpoints(git, shadow)).find((item) => item.id === id)
  if (!checkpoint) {
    throw new Error('The checkpoint was written but could not be read back.')
  }
  return { checkpoint, created: true }
}

/** Deletes checkpoints past the count or age limit, never the newest. Returns how many. */
export async function pruneCheckpoints(
  git: CheckpointGit,
  shadow: Shadow,
  limits: { keep: number; retentionDays: number; now: number }
): Promise<number> {
  const all = await listCheckpoints(git, shadow)
  const cutoff = limits.now - limits.retentionDays * 86_400_000
  const doomed = all.filter(
    (item, index) =>
      index < all.length - 1 && (index < all.length - limits.keep || item.createdAt < cutoff)
  )
  for (const item of doomed) {
    await inShadow(git, shadow, [
      'update-ref',
      '-d',
      `${FORK_TURN_CHECKPOINT_REF_PREFIX}${item.id}`
    ])
  }
  if (doomed.length > 0) {
    await inShadow(git, shadow, ['gc', '--prune=now', '--quiet']).catch(() => undefined)
  }
  return doomed.length
}
