// Worktree ports (FORK.md, SLRM-2383): the reservations of one host, kept in
// fork-worktree-ports.json in its userData so they survive a restart. Reserves are synchronous
// because terminal and setup env is built synchronously: the file is read once, on first use, and
// each change is written in the background, one write at a time, the newest state last.
//
// Free ports: a reserve takes the spare block, one block ahead that a background pass has bound
// and found free on this machine, when there is one; otherwise the first block clear of every
// reservation and of the ports earlier passes found in use. Each reserve starts the next pass.
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname } from 'node:path'
import { z } from 'zod'
import {
  FORK_WORKTREE_PORTS_MAX_COUNT,
  FORK_WORKTREE_PORTS_MAX_PORT,
  FORK_WORKTREE_PORTS_MIN_PORT,
  type ForkWorktreePortBlock,
  type ForkWorktreePortsConfig
} from '../../../shared/fork/worktree-ports'

export const FORK_WORKTREE_PORTS_FILE = 'fork-worktree-ports.json'
/** More reservations than any host holds workspaces; a hand-edited file is cut here. */
const MAX_BLOCKS = 10_000
const MAX_ID_LENGTH = 4096
/** Candidate blocks one background pass tries before it gives up until the next reserve. */
const MAX_PROBED_CANDIDATES = 64

type Range = Pick<ForkWorktreePortsConfig, 'count' | 'from' | 'to'>
export type PortProbe = (port: number) => Promise<boolean>

const BlockSchema = z
  .object({
    worktreeId: z.string().min(1).max(MAX_ID_LENGTH),
    start: z.number().int().min(FORK_WORKTREE_PORTS_MIN_PORT),
    count: z.number().int().min(1).max(FORK_WORKTREE_PORTS_MAX_COUNT),
    reservedAt: z.number()
  })
  .refine((block) => block.start + block.count - 1 <= FORK_WORKTREE_PORTS_MAX_PORT)

const FileSchema = z.object({ blocks: z.array(z.unknown()) })

/** Rows of the file, each checked on its own; a bad row is dropped, not the file. */
function readBlocks(text: string): ForkWorktreePortBlock[] {
  const file = FileSchema.safeParse(JSON.parse(text))
  const rows = file.success ? file.data.blocks.slice(0, MAX_BLOCKS) : []
  return rows.flatMap((row) => {
    const block = BlockSchema.safeParse(row)
    return block.success ? [block.data] : []
  })
}

function errorCode(error: unknown): unknown {
  return error instanceof Error && 'code' in error ? error.code : undefined
}

function listenOnce(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.unref()
    server.once('error', (error) => {
      // A host without that address family cannot have a listener on it either.
      const code = errorCode(error)
      resolve(code === 'EAFNOSUPPORT' || code === 'EADDRNOTAVAIL')
    })
    server.listen({ port, host, exclusive: true }, () => server.close(() => resolve(true)))
  })
}

/** Free when nothing listens on it on loopback or on every address. Binds and closes at once. */
export async function isPortFreeOnThisHost(port: number): Promise<boolean> {
  for (const host of ['127.0.0.1', '0.0.0.0', '::']) {
    if (!(await listenOnce(port, host))) {
      return false
    }
  }
  return true
}

export class ForkWorktreePortRegistry {
  private blocks: Map<string, ForkWorktreePortBlock> | null = null
  private spare: { start: number; count: number } | null = null
  private busy = new Set<number>()
  private pass: Promise<void> | null = null
  private writing: Promise<void> = Promise.resolve()

  constructor(
    private readonly filePath: string,
    private readonly probe: PortProbe = isPortFreeOnThisHost,
    private readonly now: () => number = Date.now
  ) {}

  private load(): Map<string, ForkWorktreePortBlock> {
    if (this.blocks) {
      return this.blocks
    }
    const blocks = new Map<string, ForkWorktreePortBlock>()
    try {
      // One read, on the first reserve or lookup of this process.
      for (const block of readBlocks(readFileSync(this.filePath, 'utf8'))) {
        // Overlapping rows can only come from a hand edit; the first keeps its ports.
        if (!blocks.has(block.worktreeId) && this.clear(blocks, block.start, block.count)) {
          blocks.set(block.worktreeId, block)
        }
      }
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        console.warn('[fork-worktree-ports] Could not read the reservations; starting empty', error)
      }
    }
    this.blocks = blocks
    return blocks
  }

  private persist(): void {
    const body = `${JSON.stringify({ version: 1, blocks: [...this.load().values()] }, null, 2)}\n`
    this.writing = this.writing.then(() => this.write(body))
  }

  private async write(body: string): Promise<void> {
    const temp = `${this.filePath}.${randomBytes(6).toString('hex')}.tmp`
    try {
      await mkdir(dirname(this.filePath), { recursive: true })
      await writeFile(temp, body, { mode: 0o600, flag: 'wx' })
      await rename(temp, this.filePath)
    } catch (error) {
      // The reservation still holds in memory; the next change writes the whole state again.
      console.warn('[fork-worktree-ports] Could not save the reservations', error)
      await rm(temp, { force: true }).catch(() => {})
    }
  }

  /** Resolves once every change so far is on disk (or failed and was logged). */
  flushed(): Promise<void> {
    return this.writing
  }

  private clear(
    blocks: ReadonlyMap<string, ForkWorktreePortBlock>,
    start: number,
    count: number
  ): boolean {
    const end = start + count - 1
    for (const block of blocks.values()) {
      if (start <= block.start + block.count - 1 && block.start <= end) {
        return false
      }
    }
    return true
  }

  /** First block from `from` clear of reservations and of `busy`; null when the range is full. */
  private firstClear(range: Range): number | null {
    const blocks = this.load()
    let start = range.from
    while (start + range.count - 1 <= range.to) {
      const end = start + range.count - 1
      let next: number | null = null
      for (const block of blocks.values()) {
        if (start <= block.start + block.count - 1 && block.start <= end) {
          next = Math.max(next ?? 0, block.start + block.count)
        }
      }
      for (let port = start; port <= end; port += 1) {
        if (this.busy.has(port)) {
          next = Math.max(next ?? 0, port + 1)
        }
      }
      if (next === null) {
        return start
      }
      start = next
    }
    return null
  }

  get(worktreeId: string): ForkWorktreePortBlock | null {
    return this.load().get(worktreeId) ?? null
  }

  list(): ForkWorktreePortBlock[] {
    return [...this.load().values()].sort((a, b) => a.start - b.start)
  }

  /** The workspace's block, reserving one when it has none. Null only when the range is full. */
  reserve(worktreeId: string, range: Range): ForkWorktreePortBlock | null {
    const existing = this.get(worktreeId)
    if (existing) {
      return existing
    }
    const spare = this.spare
    const useSpare =
      spare !== null &&
      spare.count === range.count &&
      spare.start >= range.from &&
      spare.start + spare.count - 1 <= range.to &&
      this.clear(this.load(), spare.start, spare.count)
    const start = useSpare ? spare.start : this.firstClear(range)
    this.spare = null
    if (start === null) {
      console.warn(
        `[fork-worktree-ports] No free block of ${range.count} ports left in ${range.from}-${range.to}`
      )
      return null
    }
    const block = { worktreeId, start, count: range.count, reservedAt: this.now() }
    this.load().set(worktreeId, block)
    this.persist()
    void this.refreshSpare(range)
    return block
  }

  release(worktreeId: string): boolean {
    if (!this.load().delete(worktreeId)) {
      return false
    }
    this.persist()
    return true
  }

  /** Drops every block `keep` says no; returns the workspaces it dropped. */
  prune(keep: (block: ForkWorktreePortBlock) => boolean): string[] {
    const dropped = [...this.load().values()].filter((block) => !keep(block))
    for (const block of dropped) {
      this.load().delete(block.worktreeId)
    }
    if (dropped.length > 0) {
      this.persist()
    }
    return dropped.map((block) => block.worktreeId)
  }

  /** Finds and binds the next spare block in the background; one pass at a time. */
  refreshSpare(range: Range): Promise<void> {
    this.pass ??= this.findSpare(range).finally(() => {
      this.pass = null
    })
    return this.pass
  }

  private async findSpare(range: Range): Promise<void> {
    const busy = new Set<number>()
    for (let tries = 0; tries < MAX_PROBED_CANDIDATES; tries += 1) {
      const start = this.firstClear(range)
      if (start === null) {
        break
      }
      let free = true
      for (let port = start; port < start + range.count; port += 1) {
        if (!(await this.probe(port).catch(() => false))) {
          busy.add(port)
          free = false
        }
      }
      if (free) {
        this.busy = busy
        this.spare = { start, count: range.count }
        return
      }
      // The busy ports move the next candidate on, and stay out of a reserve made meanwhile.
      this.busy = new Set([...this.busy, ...busy])
    }
    this.busy = busy
  }
}
