// Best of N (FORK.md, SLRM-2393): the runs, kept in fork-best-of.json in userData so the compare
// view outlives a restart. Reads and writes are async and serialized; the newest runs are kept, up
// to the history setting.
import { randomBytes } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  FORK_BEST_OF_HISTORY_DEFAULT,
  findForkBestOfRun,
  forkBestOfTitle,
  type ForkBestOfRun
} from '../../../shared/fork/best-of/best-of'
import {
  ForkBestOfRecordParams,
  ForkBestOfSettleParams
} from '../../../shared/fork/best-of/best-of-wire'
import { z } from 'zod'

export const FORK_BEST_OF_FILE = 'fork-best-of.json'

const StoredRun = ForkBestOfRecordParams.extend({
  id: z.string().regex(/^[a-f0-9]{12}$/),
  createdAt: z.number(),
  title: z.string().max(512),
  attempts: ForkBestOfRecordParams.shape.attempts.element
    .extend({ outcome: ForkBestOfSettleParams.shape.outcomes.element.shape.outcome.optional() })
    .array(),
  winner: z.number().int().optional(),
  pickedAt: z.number().optional(),
  loserAction: ForkBestOfSettleParams.shape.loserAction.optional()
})

function valid(run: unknown): run is ForkBestOfRun {
  return StoredRun.safeParse(run).success
}

export class ForkBestOfStore {
  private runs: ForkBestOfRun[] = []
  private loading: Promise<void> | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly path: string,
    private readonly now: () => number = Date.now
  ) {}

  /** Newest first. */
  list(): Promise<ForkBestOfRun[]> {
    return this.run(async () => this.runs)
  }

  get(query: string): Promise<ForkBestOfRun> {
    return this.run(async () => findForkBestOfRun(this.runs, query))
  }

  record(params: ForkBestOfRecordParams, keep: number = FORK_BEST_OF_HISTORY_DEFAULT) {
    return this.run(async () => {
      // A dispatch belongs to one run, so a pick never reaches a worker another run owns.
      const taken = new Set(
        this.runs.flatMap((run) => run.attempts.map((attempt) => attempt.dispatchId))
      )
      const ids = params.attempts.map((attempt) => attempt.dispatchId).filter(Boolean)
      if (new Set(ids).size !== ids.length || ids.some((id) => taken.has(id))) {
        throw new Error('A worker can be an attempt of one best-of run only.')
      }
      const run: ForkBestOfRun = {
        ...params,
        id: randomBytes(6).toString('hex'),
        createdAt: this.now(),
        title: forkBestOfTitle(params.prompt),
        attempts: [...params.attempts].sort((a, b) => a.index - b.index)
      }
      await this.write([run, ...this.runs].slice(0, Math.max(1, keep)))
      return run
    })
  }

  /** Records a pick once; a second pick of the same run is refused. */
  settle(params: ForkBestOfSettleParams): Promise<ForkBestOfRun> {
    return this.run(async () => {
      const found = findForkBestOfRun(this.runs, params.id)
      if (found.winner !== undefined) {
        throw new Error(`Attempt ${found.winner} was already picked for this run.`)
      }
      if (!found.attempts.some((attempt) => attempt.index === params.winner)) {
        throw new Error(`Attempt ${params.winner} is not in this run.`)
      }
      const outcomes = new Map(params.outcomes.map((entry) => [entry.index, entry.outcome]))
      const settled: ForkBestOfRun = {
        ...found,
        winner: params.winner,
        pickedAt: this.now(),
        loserAction: params.loserAction,
        attempts: found.attempts.map((attempt) => {
          const outcome = outcomes.get(attempt.index)
          return outcome ? { ...attempt, outcome } : attempt
        })
      }
      await this.write(this.runs.map((run) => (run.id === found.id ? settled : run)))
      return settled
    })
  }

  forget(query: string): Promise<ForkBestOfRun> {
    return this.run(async () => {
      const found = findForkBestOfRun(this.runs, query)
      await this.write(this.runs.filter((run) => run.id !== found.id))
      return found
    })
  }

  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      await this.load()
      return task()
    })
    this.queue = next.catch(() => undefined)
    return next
  }

  private load(): Promise<void> {
    this.loading ??= readFile(this.path, 'utf8').then(
      (text) => {
        const raw = JSON.parse(text) as { runs?: unknown[] }
        this.runs = (Array.isArray(raw.runs) ? raw.runs : []).filter(valid)
      },
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') {
          console.error('[best-of] Could not read the best-of file:', error)
        }
      }
    )
    return this.loading.catch((error: unknown) => {
      console.error('[best-of] Could not read the best-of file:', error)
    })
  }

  private async write(next: ForkBestOfRun[]): Promise<void> {
    const temp = `${this.path}.${process.pid}.tmp`
    try {
      await writeFile(temp, JSON.stringify({ version: 1, runs: next }, null, 2), { mode: 0o600 })
      await rename(temp, this.path)
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined)
      throw error
    }
    this.runs = next
  }
}

let shared: ForkBestOfStore | null = null

/** The process's store, in the given userData folder (the first caller's folder wins). */
export function forkBestOfStore(userDataPath: string): ForkBestOfStore {
  shared ??= new ForkBestOfStore(join(userDataPath, FORK_BEST_OF_FILE))
  return shared
}
