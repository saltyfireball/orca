import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FORK_SNOOZE_FILE, ForkSnoozeStore } from './snooze-store'

const WS = { kind: 'workspace' as const, worktreeId: 'repo::/w/a', hostId: 'local' }
let dir: string
let now: number
let stores: ForkSnoozeStore[]

function open(): ForkSnoozeStore {
  const store = new ForkSnoozeStore(join(dir, FORK_SNOOZE_FILE), () => now)
  stores.push(store)
  return store
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fork-snooze-'))
  now = 1_000_000
  stores = []
})

afterEach(() => {
  stores.forEach((store) => store.dispose())
  rmSync(dir, { recursive: true, force: true })
})

describe('ForkSnoozeStore', () => {
  it('keeps snoozes across a restart in an owner-only file', async () => {
    const entry = await open().snooze(WS, { kind: 'merge' }, 'feature')
    expect(await open().list()).toEqual([entry])
    const path = join(dir, FORK_SNOOZE_FILE)
    expect(JSON.parse(readFileSync(path, 'utf8')).entries).toHaveLength(1)
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o600)
    }
  })

  it('replaces a snooze of the same workspace and tells listeners', async () => {
    const store = open()
    const heard: number[] = []
    store.onChanged((entries) => heard.push(entries.length))
    await store.snooze(WS, { kind: 'merge' }, 'a')
    const second = await store.snooze(WS, { kind: 'idle', days: 2 }, 'a')
    expect(await store.list()).toEqual([second])
    expect(heard).toEqual([1, 1])
  })

  it('wakes by id prefix and takes by exact id only', async () => {
    const store = open()
    const entry = await store.snooze(WS, { kind: 'merge' }, 'a')
    expect(await store.take(entry.id.slice(0, 6))).toBeNull()
    expect((await store.wake(entry.id.slice(0, 6))).id).toBe(entry.id)
    expect(await store.list()).toEqual([])
    await expect(store.wake('ffffff')).rejects.toThrow(/No snooze/)
  })

  it('drops a timed snooze once its time has come', async () => {
    const store = open()
    await store.snooze(WS, { kind: 'time', at: now + 5000 }, 'a')
    expect(await store.list()).toHaveLength(1)
    now += 5000
    expect(await store.list()).toEqual([])
  })

  it('skips malformed entries and a broken file', async () => {
    const path = join(dir, FORK_SNOOZE_FILE)
    writeFileSync(
      path,
      JSON.stringify({ entries: [{ id: 'nope', target: WS, until: { kind: 'merge' } }] })
    )
    expect(await open().list()).toEqual([])
    writeFileSync(path, '{not json')
    const store = open()
    expect(await store.list()).toEqual([])
    await store.snooze(WS, { kind: 'merge' }, 'a')
    expect(await store.list()).toHaveLength(1)
  })
})
