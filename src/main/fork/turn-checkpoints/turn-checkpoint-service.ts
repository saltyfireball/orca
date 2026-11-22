// BAD-678 (FORK.md "Turn checkpoints"): the service over the git work. One instance serves one
// host; every workspace's captures and restores run one at a time through its own queue, so a
// capture never reads the files while a restore rewrites them. Pure of electron: the live wiring
// (settings, the agent hook feed, the paths) is in `turn-checkpoint-live.ts`, tests build their own.
import { createHash } from 'node:crypto'
import { readdir, readFile, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type {
  ForkTurnCheckpointConfig,
  ForkTurnCheckpointsDiffResult,
  ForkTurnCheckpointsListResult,
  ForkTurnCheckpointsRestoreResult
} from '../../../shared/fork/turn-checkpoints'
import { diffCheckpoint } from './turn-checkpoint-diff'
import { restoreCheckpoint } from './turn-checkpoint-restore'
import type { CheckpointGit, CheckpointOrigin, Shadow } from './turn-checkpoint-shadow'
import {
  captureCheckpoint,
  listCheckpoints,
  pruneCheckpoints,
  publicCheckpoint
} from './turn-checkpoint-store'

export type TurnCheckpointServiceDeps = {
  git: CheckpointGit
  /** The folder holding one shadow store per workspace. */
  root: string
  config: () => ForkTurnCheckpointConfig
  now: () => number
  /** Agents that look busy in the workspace's folder right now (their ids or names). */
  busyAgents: (workspacePath: string) => string[]
}

export type TurnCheckpointService = ReturnType<typeof createTurnCheckpointService>

const MB = 1024 * 1024

/** The shadow store for a workspace folder; the name is a hash so nothing about the path leaks. */
export function shadowFor(root: string, workspacePath: string): Shadow {
  const workTree = resolve(workspacePath)
  const name = createHash('sha256').update(workTree).digest('hex').slice(0, 24)
  return { gitDir: join(root, `${name}.git`), workTree }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** A home folder or a drive root is no workspace: snapshotting it would read the whole machine. */
export function isTooBroadForCheckpoints(workspacePath: string): boolean {
  const resolved = resolve(workspacePath)
  const parts = resolved.split(/[\\/]+/).filter(Boolean)
  return parts.length < 2 || resolved === resolve(homedir())
}

export function createTurnCheckpointService(deps: TurnCheckpointServiceDeps) {
  const queues = new Map<string, Promise<unknown>>()

  function enqueue<T>(workspacePath: string, task: () => Promise<T>): Promise<T> {
    const key = resolve(workspacePath)
    const run = (queues.get(key) ?? Promise.resolve()).then(task, task)
    const tail = run.catch(() => undefined)
    queues.set(key, tail)
    void tail.then(() => {
      if (queues.get(key) === tail) {
        queues.delete(key)
      }
    })
    return run
  }

  function limits() {
    const config = deps.config()
    return { config, maxFileBytes: config.maxFileMb * MB }
  }

  async function usable(workspacePath: string): Promise<boolean> {
    return !isTooBroadForCheckpoints(workspacePath) && (await isDirectory(workspacePath))
  }

  /**
   * Called when an agent in the workspace ends a turn (`kind` 'turn') or starts one with no
   * checkpoint yet (`kind` 'baseline'). Makes at most one checkpoint, and none when the files are
   * the same as the newest checkpoint's. Resolves true when it made one. Never throws.
   */
  function captureForTurn(
    workspacePath: string,
    kind: 'turn' | 'baseline',
    origin: CheckpointOrigin = {}
  ): Promise<boolean> {
    return enqueue(workspacePath, async () => {
      const { config, maxFileBytes } = limits()
      if (!config.enabled || !(await usable(workspacePath))) {
        return false
      }
      const shadow = shadowFor(deps.root, workspacePath)
      try {
        if (kind === 'baseline' && (await listCheckpoints(deps.git, shadow)).length > 0) {
          return false
        }
        const empty = (await listCheckpoints(deps.git, shadow)).length === 0
        const { created } = await captureCheckpoint(deps.git, shadow, {
          kind: kind === 'turn' && empty ? 'baseline' : kind,
          now: deps.now(),
          maxFileBytes,
          dedupe: true,
          origin
        })
        if (created) {
          await pruneCheckpoints(deps.git, shadow, {
            keep: config.keep,
            retentionDays: config.retentionDays,
            now: deps.now()
          })
        }
        return created
      } catch (error) {
        console.warn(`[fork-turn-checkpoints] Could not checkpoint ${workspacePath}`, error)
        return false
      }
    })
  }

  function list(workspacePath: string): Promise<ForkTurnCheckpointsListResult> {
    return enqueue(workspacePath, async () => {
      const { config } = limits()
      const shadow = shadowFor(deps.root, workspacePath)
      const checkpoints = (await listCheckpoints(deps.git, shadow)).map(publicCheckpoint)
      return {
        enabled: config.enabled,
        path: shadow.workTree,
        retentionDays: config.retentionDays,
        keep: config.keep,
        checkpoints: checkpoints.toReversed()
      }
    })
  }

  function diff(
    workspacePath: string,
    id: string,
    options: { now?: boolean; patch?: boolean }
  ): Promise<ForkTurnCheckpointsDiffResult> {
    return enqueue(workspacePath, async () => {
      const { maxFileBytes } = limits()
      const result = await diffCheckpoint(deps.git, shadowFor(deps.root, workspacePath), id, {
        now: options.now === true,
        patch: options.patch === true,
        maxFileBytes
      })
      return {
        checkpoint: publicCheckpoint(result.checkpoint),
        against: result.against,
        files: result.files,
        excludedMergedFiles: result.excludedMergedFiles,
        patch: result.patch,
        patchTruncated: result.patchTruncated
      }
    })
  }

  function refuseWhileBusy(workspacePath: string, force: boolean | undefined): void {
    const busy = deps.busyAgents(workspacePath)
    if (busy.length > 0 && !force) {
      throw new Error(
        `Another agent is working in ${workspacePath} (${busy.slice(0, 3).join(', ')}). ` +
          'Restoring files under it would race its edits. Wait for it to finish, stop it, ' +
          'or pass --force.'
      )
    }
  }

  function restore(
    workspacePath: string,
    id: string,
    options: { force?: boolean } = {}
  ): Promise<ForkTurnCheckpointsRestoreResult> {
    return enqueue(workspacePath, async () => {
      refuseWhileBusy(workspacePath, options.force)
      const { maxFileBytes } = limits()
      if (!(await usable(workspacePath))) {
        throw new Error(`${workspacePath} is not a folder checkpoints can restore into.`)
      }
      const outcome = await restoreCheckpoint(deps.git, shadowFor(deps.root, workspacePath), id, {
        now: deps.now(),
        maxFileBytes
      })
      return {
        restoredTo: publicCheckpoint(outcome.target),
        preRestore: outcome.changedFiles > 0 ? publicCheckpoint(outcome.pre) : null,
        restore: outcome.restore ? publicCheckpoint(outcome.restore) : null,
        changedFiles: outcome.changedFiles,
        note:
          outcome.changedFiles === 0
            ? 'The files already match this checkpoint; nothing changed.'
            : null
      }
    })
  }

  /** Reverses the latest restore. Run again, it puts the restore back. */
  async function undo(
    workspacePath: string,
    options: { force?: boolean } = {}
  ): Promise<ForkTurnCheckpointsRestoreResult> {
    const shadow = shadowFor(deps.root, workspacePath)
    const latest = (await enqueue(workspacePath, () => listCheckpoints(deps.git, shadow))).findLast(
      (item) => item.kind === 'restore' && item.undoTo
    )
    if (!latest?.undoTo) {
      throw new Error('There is no restore to undo.')
    }
    return restore(workspacePath, latest.undoTo, options)
  }

  /** Removes the shadow stores whose newest checkpoint is past the retention period. */
  async function sweepStores(): Promise<number> {
    let names: string[]
    try {
      names = await readdir(deps.root)
    } catch {
      return 0
    }
    const { config } = limits()
    const cutoff = deps.now() - config.retentionDays * 86_400_000
    let removed = 0
    for (const name of names.filter((entry) => entry.endsWith('.git'))) {
      const gitDir = join(deps.root, name)
      let path = ''
      try {
        path = (await readFile(join(gitDir, 'orca-path'), 'utf8')).trim()
      } catch {
        continue
      }
      if (!path) {
        continue
      }
      // A folder that is missing (an unmounted drive) keeps its checkpoints until they expire.
      const all = await listCheckpoints(deps.git, { gitDir, workTree: path }).catch(() => null)
      const expired = all !== null && all.length > 0 && (all.at(-1)?.createdAt ?? 0) < cutoff
      if (expired) {
        await enqueue(path, () => rm(gitDir, { recursive: true, force: true })).catch(
          () => undefined
        )
        removed += 1
      }
    }
    return removed
  }

  return { captureForTurn, list, diff, restore, undo, sweepStores }
}
