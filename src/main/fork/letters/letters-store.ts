// Letters and the board (FORK.md, SLRM-2389): this host's letters, asks, the rate log and the
// paired servers it has written to, kept in fork-letters.json in the data folder (mode 0600) so a
// restart keeps the queue. Reads and writes are async and run one at a time; a write is atomic.
// Keep electron out of this file: orcad keeps the same store.
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  pruneForkBoardAsks,
  pruneForkLetters,
  type ForkBoardAsk,
  type ForkLetter,
  type ForkLetterSent
} from '../../../shared/fork/letters'

export const FORK_LETTERS_FILE = 'fork-letters.json'

export type ForkLettersState = {
  letters: ForkLetter[]
  asks: ForkBoardAsk[]
  sent: ForkLetterSent[]
  /** Paired server id -> when this host last handed it a letter (it may answer through collect). */
  peers: Record<string, number>
}

export const emptyForkLettersState = (): ForkLettersState => ({
  letters: [],
  asks: [],
  sent: [],
  peers: {}
})

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function isParty(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.chatId === 'string' &&
    typeof value.kind === 'string' &&
    typeof value.title === 'string' &&
    (value.host === null || isObject(value.host))
  )
}

function isLetter(value: unknown): value is ForkLetter {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.text === 'string' &&
    typeof value.at === 'number' &&
    typeof value.state === 'string' &&
    isParty(value.from) &&
    isParty(value.to)
  )
}

function isAsk(value: unknown): value is ForkBoardAsk {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.type === 'string' &&
    typeof value.at === 'number' &&
    typeof value.state === 'string' &&
    isParty(value.from)
  )
}

function isSent(value: unknown): value is ForkLetterSent {
  return (
    isObject(value) &&
    typeof value.at === 'number' &&
    typeof value.from === 'string' &&
    typeof value.to === 'string'
  )
}

/** A file as read back: anything missing or malformed is empty, never a crash. */
export function parseForkLettersState(raw: unknown, now: number): ForkLettersState {
  if (!isObject(raw)) {
    return emptyForkLettersState()
  }
  const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
  const peers: Record<string, number> = {}
  if (isObject(raw.peers)) {
    for (const [id, at] of Object.entries(raw.peers)) {
      if (typeof at === 'number') {
        peers[id] = at
      }
    }
  }
  return {
    letters: pruneForkLetters(list(raw.letters).filter(isLetter), now),
    asks: pruneForkBoardAsks(list(raw.asks).filter(isAsk), now),
    sent: list(raw.sent).filter(isSent),
    peers
  }
}

export type ForkLettersUpdate<T> = { next?: ForkLettersState; result: T }

export class ForkLettersStore {
  private state: ForkLettersState = emptyForkLettersState()
  private loading: Promise<void> | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private readonly listeners = new Set<() => void>()

  constructor(
    private readonly path: string,
    private readonly now: () => number = Date.now
  ) {}

  onChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  read(): Promise<ForkLettersState> {
    return this.update((state) => ({ result: state }))
  }

  /** Runs after every earlier call; a returned `next` is written before the result resolves. */
  update<T>(task: (state: ForkLettersState) => ForkLettersUpdate<T>): Promise<T> {
    const run = this.queue.then(async () => {
      await this.load()
      const { next, result } = task(this.state)
      if (next) {
        await this.write(next)
      }
      return result
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  private load(): Promise<void> {
    this.loading ??= readFile(this.path, 'utf8').then(
      (text) => {
        this.state = parseForkLettersState(JSON.parse(text), this.now())
      },
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') {
          console.warn('[fork-letters] could not read the letters file:', error.message)
        }
      }
    )
    return this.loading.catch((error: unknown) => {
      console.warn('[fork-letters] could not read the letters file:', error)
    })
  }

  private async write(next: ForkLettersState): Promise<void> {
    const now = this.now()
    const pruned: ForkLettersState = {
      ...next,
      letters: pruneForkLetters(next.letters, now),
      asks: pruneForkBoardAsks(next.asks, now)
    }
    const temp = `${this.path}.${process.pid}.tmp`
    try {
      await writeFile(temp, JSON.stringify({ version: 1, ...pruned }), { mode: 0o600 })
      await rename(temp, this.path)
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined)
      throw error
    }
    this.state = pruned
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        console.warn('[fork-letters] change listener failed', error)
      }
    }
  }
}

let shared: ForkLettersStore | null = null

/** The process's store, in the given data folder (the first caller's folder wins). */
export function forkLettersStore(userDataPath: string): ForkLettersStore {
  shared ??= new ForkLettersStore(join(userDataPath, FORK_LETTERS_FILE))
  return shared
}
