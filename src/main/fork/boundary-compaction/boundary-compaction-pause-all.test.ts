// Boundary compaction under Pause all (BAD-818): the real sweep with the real switch in a temporary
// data folder. While paused no chat is read or asked to compact (also with an unreadable switch, and
// when the switch is engaged during a run); releasing it runs a sweep at once, which compacts the
// chat it held. Faked: the chat host (its chats, their rest, journal and compact command).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const paths = vi.hoisted(() => ({ userData: '' }))
vi.mock('../../../shared/app-lifecycle/app-environment', () => ({
  getAppEnvironment: () => ({ getPath: () => paths.userData }),
  hasAppEnvironment: () => true
}))

import {
  PAUSE_ALL_STATE_FILE_NAME,
  resetForkPauseAllCacheForTests,
  writeForkPauseAll
} from '../pause-all/pause-all-state'
import type { BoundaryCompactionHost } from './boundary-compaction-host'
import {
  createBoundaryCompactionService,
  type BoundaryCompactionService
} from './boundary-compaction-service'

const NOW = 1_700_000_000_000
const MINUTE = 60_000

let service: BoundaryCompactionService | null = null

beforeEach(() => {
  paths.userData = mkdtempSync(join(tmpdir(), 'compaction-pause-all-'))
  resetForkPauseAllCacheForTests()
})
afterEach(() => {
  service?.stop()
  service = null
  resetForkPauseAllCacheForTests()
  rmSync(paths.userData, { recursive: true, force: true })
})

/** One idle chat past the threshold, its cache about to go cold: the rule asks it to compact. */
function setup(onJournal: () => void = () => {}) {
  const compacted: string[] = []
  const host = {
    chatIds: vi.fn(() => ['a']),
    rest: vi.fn(() => ({
      fence: 3,
      compactable: true,
      awake: true,
      inTurn: false,
      backgroundRunning: false,
      idleSince: NOW - 30 * MINUTE
    })),
    journal: vi.fn(async () => {
      onJournal()
      return {
        requestItemId: 'request-1',
        commandSinceRequest: false,
        queued: false,
        contextTokens: 150_000,
        measuredAt: NOW - 31 * MINUTE
      }
    }),
    compact: vi.fn(async (sessionId: string) => {
      compacted.push(sessionId)
      return 'started' as const
    })
  } satisfies BoundaryCompactionHost
  service = createBoundaryCompactionService({
    now: () => NOW,
    host,
    typed: () => false,
    forgetTyped: () => {},
    cacheStates: () => [],
    randomId: () => 'r4nd0m',
    startTimer: () => () => {}
  })
  service.start(() => ({ forkBoundaryCompactMode: 'on' }))
  return { host, compacted, service }
}

describe('boundary compaction while paused', () => {
  it('reads and compacts nothing while paused, and compacts at once at resume-all', async () => {
    const { host, compacted, service } = setup()
    writeForkPauseAll(true, { by: 'cli' })
    expect(await service.sweep()).toBe(true)
    expect(host.chatIds).not.toHaveBeenCalled()
    expect(compacted).toEqual([])

    writeForkPauseAll(false, { by: 'cli' })
    await vi.waitFor(() => expect(compacted).toEqual(['a']))
  })

  it('holds with an unreadable switch', async () => {
    const { compacted, service } = setup()
    writeFileSync(join(paths.userData, PAUSE_ALL_STATE_FILE_NAME), '{ broken')
    resetForkPauseAllCacheForTests()
    await service.sweep()
    expect(compacted).toEqual([])
  })

  it('asks nothing when the switch is engaged during a run, and asks again at resume-all', async () => {
    let engage = true
    const { compacted, service } = setup(() => {
      if (engage) {
        engage = false
        writeForkPauseAll(true, { by: 'cli' })
      }
    })
    await service.sweep()
    expect(compacted).toEqual([])
    writeForkPauseAll(false, { by: 'cli' })
    await vi.waitFor(() => expect(compacted).toEqual(['a']))
  })
})
