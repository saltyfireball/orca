import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FORK_WORKTREE_PORTS_FILE,
  ForkWorktreePortRegistry,
  isPortFreeOnThisHost,
  type PortProbe
} from './worktree-port-registry'

const RANGE = { count: 10, from: 20000, to: 20049 }
let dir: string
let file: string
const free: PortProbe = async () => true

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fork-worktree-ports-'))
  file = join(dir, FORK_WORKTREE_PORTS_FILE)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

describe('ForkWorktreePortRegistry', () => {
  it('gives each workspace its own block and keeps it across a restart', async () => {
    const first = new ForkWorktreePortRegistry(file, free, () => 5)
    const a = first.reserve('repo::/w/a', RANGE)
    const b = first.reserve('repo::/w/b', RANGE)
    expect(a).toEqual({ worktreeId: 'repo::/w/a', start: 20000, count: 10, reservedAt: 5 })
    expect(b?.start).toBe(20010)
    expect(first.reserve('repo::/w/a', RANGE)).toEqual(a)
    await first.flushed()
    expect(statSync(file).mode & 0o777).toBe(0o600)

    const second = new ForkWorktreePortRegistry(file, free)
    expect(second.get('repo::/w/a')).toEqual(a)
    expect(second.reserve('repo::/w/c', RANGE)?.start).toBe(20020)
  })

  it('reuses a released block and says when the range is full', async () => {
    const registry = new ForkWorktreePortRegistry(file, free)
    for (const name of ['a', 'b', 'c', 'd', 'e']) {
      expect(registry.reserve(`repo::/w/${name}`, RANGE)).not.toBeNull()
    }
    expect(registry.reserve('repo::/w/f', RANGE)).toBeNull()
    expect(registry.release('repo::/w/b')).toBe(true)
    expect(registry.release('repo::/w/b')).toBe(false)
    expect(registry.reserve('repo::/w/f', RANGE)?.start).toBe(20010)
    await registry.flushed()
    expect(new ForkWorktreePortRegistry(file, free).get('repo::/w/b')).toBeNull()
  })

  it('fits a new block of another size between old ones', () => {
    const registry = new ForkWorktreePortRegistry(file, free)
    registry.reserve('repo::/w/a', { ...RANGE, count: 5 })
    expect(registry.reserve('repo::/w/b', RANGE)?.start).toBe(20005)
  })

  it('takes the spare block a background pass found free, skipping busy ports', async () => {
    const busy = new Set([20000, 20013])
    const probe = vi.fn<PortProbe>(async (port) => !busy.has(port))
    const registry = new ForkWorktreePortRegistry(file, probe)
    await registry.refreshSpare(RANGE)
    // 20000 is busy, so 20001-20010; then 20013 sits in the next candidate.
    expect(registry.reserve('repo::/w/a', RANGE)?.start).toBe(20001)
    await registry.refreshSpare(RANGE)
    expect(registry.reserve('repo::/w/b', RANGE)?.start).toBe(20014)
  })

  it('keeps ports a pass found busy out of a reserve made before the next spare is ready', async () => {
    const registry = new ForkWorktreePortRegistry(file, async (port) => port !== 20002)
    await registry.refreshSpare(RANGE)
    // A block of another size cannot take the spare; the sync path still steps past 20002.
    expect(registry.reserve('repo::/w/a', { ...RANGE, count: 5 })?.start).toBe(20003)
    await registry.refreshSpare(RANGE)
  })

  it('drops what prune is told to and reads a damaged file as empty', async () => {
    const registry = new ForkWorktreePortRegistry(file, free)
    registry.reserve('repo::/w/a', RANGE)
    registry.reserve('repo::/w/b', RANGE)
    expect(registry.prune((block) => block.worktreeId !== 'repo::/w/a')).toEqual(['repo::/w/a'])
    await registry.flushed()
    expect(JSON.parse(readFileSync(file, 'utf8')).blocks).toHaveLength(1)

    writeFileSync(file, '{not json')
    expect(new ForkWorktreePortRegistry(file, free).list()).toEqual([])
  })

  it('ignores hand-edited rows that are out of range, duplicated or overlapping', () => {
    const row = (worktreeId: string, start: number, count = 10) => ({
      worktreeId,
      start,
      count,
      reservedAt: 1
    })
    writeFileSync(
      file,
      JSON.stringify({
        blocks: [row('a', 20000), row('a', 20100), row('b', 20005), row('c', 80), row('d', 65530)]
      })
    )
    expect(
      new ForkWorktreePortRegistry(file, free).list().map((block) => block.worktreeId)
    ).toEqual(['a'])
  })
})

describe('isPortFreeOnThisHost', () => {
  let server: Server | null = null
  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
    server = null
  })

  it('says a port with a loopback listener is not free', async () => {
    server = createServer()
    const port = await new Promise<number>((resolve) =>
      server!.listen(0, '127.0.0.1', () => {
        const address = server!.address()
        resolve(typeof address === 'object' && address !== null ? address.port : 0)
      })
    )
    expect(await isPortFreeOnThisHost(port)).toBe(false)
  })
})
