// Snooze (FORK.md, SLRM-2269): the snoozes, kept in fork-snooze.json in userData so they survive
// a restart. Reads and writes are async and serialized. A timed snooze that has passed is dropped
// on the next read, and a timer drops the next one due so the window hears of it.
import { randomBytes } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  FORK_SNOOZE_MAX_ENTRIES,
  findForkSnoozeEntry,
  forkSnoozeTargetKey,
  type ForkSnoozeEntry,
  type ForkSnoozeTarget,
  type ForkSnoozeUntil
} from '../../../shared/fork/snooze'
import { ForkSnoozeTargetSchema, ForkSnoozeUntilSchema } from '../../../shared/fork/snooze-wire'

export const FORK_SNOOZE_FILE = 'fork-snooze.json'
/** Longest a due-check timer waits, so a clock change is caught within the hour. */
const MAX_TIMER_MS = 60 * 60_000

function valid(entry: unknown): entry is ForkSnoozeEntry {
  const value = entry as Partial<ForkSnoozeEntry> | null
  return (
    typeof value?.id === 'string' &&
    /^[a-f0-9]{12}$/.test(value.id) &&
    typeof value.label === 'string' &&
    typeof value.snoozedAt === 'number' &&
    (value.noCleanup === undefined || typeof value.noCleanup === 'boolean') &&
    ForkSnoozeTargetSchema.safeParse(value.target).success &&
    ForkSnoozeUntilSchema.safeParse(value.until).success
  )
}

export class ForkSnoozeStore {
  private entries: ForkSnoozeEntry[] = []
  private loading: Promise<void> | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private timer: NodeJS.Timeout | null = null
  private readonly listeners = new Set<(entries: ForkSnoozeEntry[]) => void>()

  constructor(
    private readonly path: string,
    private readonly now: () => number = Date.now
  ) {}

  onChanged(listener: (entries: ForkSnoozeEntry[]) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  list(): Promise<ForkSnoozeEntry[]> {
    return this.run(async () => this.entries)
  }

  /** Snooze a workspace or chat; a snooze of the same one is replaced. */
  snooze(
    target: ForkSnoozeTarget,
    until: ForkSnoozeUntil,
    label: string,
    options: { noCleanup?: boolean } = {}
  ): Promise<ForkSnoozeEntry> {
    return this.run(async () => {
      const key = forkSnoozeTargetKey(target)
      const rest = this.entries.filter((entry) => forkSnoozeTargetKey(entry.target) !== key)
      if (rest.length >= FORK_SNOOZE_MAX_ENTRIES) {
        throw new Error(`At most ${FORK_SNOOZE_MAX_ENTRIES} snoozes at once; wake some first.`)
      }
      const entry: ForkSnoozeEntry = {
        id: randomBytes(6).toString('hex'),
        target,
        until,
        label: label.slice(0, 512),
        snoozedAt: this.now(),
        ...(options.noCleanup ? { noCleanup: true } : {})
      }
      await this.write([...rest, entry])
      return entry
    })
  }

  /** End a snooze by id or unique prefix; throws when none or several match. */
  wake(query: string): Promise<ForkSnoozeEntry> {
    return this.run(async () => {
      const found = findForkSnoozeEntry(this.entries, query)
      if (!found.ok) {
        throw new Error(found.error)
      }
      await this.write(this.entries.filter((entry) => entry.id !== found.entry.id))
      return found.entry
    })
  }

  /** End the snooze with exactly this id; null when it is already gone. */
  take(id: string): Promise<ForkSnoozeEntry | null> {
    return this.run(async () => {
      const entry = this.entries.find((candidate) => candidate.id === id) ?? null
      if (entry) {
        await this.write(this.entries.filter((candidate) => candidate.id !== id))
      }
      return entry
    })
  }

  /** Stop the due-check timer (tests and shutdown). */
  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  // Every call waits for the load and runs after the previous one, then drops what is due.
  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      await this.load()
      await this.dropDue()
      return task()
    })
    this.queue = next.catch(() => undefined)
    return next
  }

  private load(): Promise<void> {
    this.loading ??= readFile(this.path, 'utf8').then(
      (text) => {
        const raw = JSON.parse(text) as { entries?: unknown[] }
        this.entries = (Array.isArray(raw.entries) ? raw.entries : []).filter(valid)
        this.schedule()
      },
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') {
          console.error('[snooze] Could not read the snooze file:', error)
        }
      }
    )
    return this.loading.catch((error: unknown) => {
      console.error('[snooze] Could not read the snooze file:', error)
    })
  }

  private async dropDue(): Promise<void> {
    const now = this.now()
    const kept = this.entries.filter((entry) => entry.until.kind !== 'time' || entry.until.at > now)
    if (kept.length !== this.entries.length) {
      await this.write(kept)
    }
  }

  private async write(next: ForkSnoozeEntry[]): Promise<void> {
    const temp = `${this.path}.${process.pid}.tmp`
    try {
      await writeFile(temp, JSON.stringify({ version: 1, entries: next }, null, 2), {
        mode: 0o600
      })
      await rename(temp, this.path)
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined)
      throw error
    }
    this.entries = next
    this.schedule()
    for (const listener of this.listeners) {
      listener(next)
    }
  }

  private schedule(): void {
    this.dispose()
    const due = this.entries
      .map((entry) => (entry.until.kind === 'time' ? entry.until.at : Infinity))
      .reduce((a, b) => Math.min(a, b), Infinity)
    if (!Number.isFinite(due)) {
      return
    }
    const delay = Math.min(Math.max(due - this.now(), 0) + 50, MAX_TIMER_MS)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.list().catch(() => undefined)
    }, delay)
    this.timer.unref?.()
  }
}

let shared: ForkSnoozeStore | null = null

/** The process's store, in the given userData folder (the first caller's folder wins). */
export function forkSnoozeStore(userDataPath: string): ForkSnoozeStore {
  shared ??= new ForkSnoozeStore(join(userDataPath, FORK_SNOOZE_FILE))
  return shared
}
