// @orca-isolated-worker the launch queue and the chat host hook keep one state per process.
// Pause all over chat worker launches across a restart (BAD-818): the real launch queue, held note
// and chat host hook, with the real switch in a temporary data folder. A recorded worker's launch
// waits and is noted; after a restart the chat host's own start is asked once, and at resume-all it
// goes on. Faked: the agent start itself, and the runtime's worker row.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const faked = vi.hoisted(() => ({ userData: '', start: vi.fn(async () => undefined) }))
vi.mock('../../../shared/app-lifecycle/app-environment', () => ({
  getAppEnvironment: () => ({ getPath: () => faked.userData }),
  hasAppEnvironment: () => true
}))
vi.mock(
  '../../native-chat/agent-session-wire/startup/structured-agent-session-agent-start',
  () => ({ startStructuredAgentSessionAgentForOperation: faked.start })
)

import { structuredAgentSessionEntryDelegates } from '../../native-chat/agent-session-wire/acquisition/structured-agent-session-entry-delegates'
import { setStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { forkAgentQueueStart, installForkAgentQueue } from '../agent-queue/agent-queue-service'
import {
  PAUSE_ALL_HELD_LAUNCHES_FILE_NAME,
  resetForkPauseAllHeldLaunchesForTests
} from './pause-all-held-launches'
import {
  PAUSE_ALL_STATE_FILE_NAME,
  resetForkPauseAllCacheForTests,
  writeForkPauseAll
} from './pause-all-state'

let worker: { dispatchId: string } | undefined
const note = (): string => join(faked.userData, PAUSE_ALL_HELD_LAUNCHES_FILE_NAME)

function install(): void {
  installForkAgentQueue(() => undefined, {
    ptys: () => undefined,
    ptyIdOfHandle: () => undefined,
    recordedWorker: () => worker
  })
}

function chatHost(): void {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the hook only keeps the context, and the queue reads a status summary.
  structuredAgentSessionEntryDelegates(() => ({ marker: 'host' }) as never)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the queue and the note read only a status summary.
  setStructuredAgentSessionHost({ readStatusSummary: () => undefined } as never)
}

function launch(sessionId: string) {
  const start = vi.fn(async () => 'started')
  const settled = forkAgentQueueStart({
    sessionId,
    resume: () => false,
    start,
    reclaim: () => start(),
    cancelled: () => ({ kind: 'cancelled' }) as never
  })
  return { start, settled }
}

beforeEach(() => {
  faked.userData = mkdtempSync(join(tmpdir(), 'pause-all-launch-'))
  faked.start.mockClear()
  worker = { dispatchId: 'ctx_1' }
  resetForkPauseAllCacheForTests()
  resetForkPauseAllHeldLaunchesForTests()
})
afterEach(() => {
  resetForkPauseAllHeldLaunchesForTests()
  setStructuredAgentSessionHost(null)
  rmSync(faked.userData, { recursive: true, force: true })
})

describe('a chat worker launch while paused', () => {
  it('waits and is noted, and after a restart the chat host starts it once', async () => {
    install()
    chatHost()
    writeForkPauseAll(true, { by: 'cli' })
    const held = launch('s1')
    void held.settled.catch(() => undefined)
    expect(held.start).not.toHaveBeenCalled()
    expect(JSON.parse(readFileSync(note(), 'utf8'))).toMatchObject({ sessions: ['s1'] })

    // The host restarts: the note is read again, and the switch was released meanwhile.
    rmSync(join(faked.userData, PAUSE_ALL_STATE_FILE_NAME))
    resetForkPauseAllCacheForTests()
    resetForkPauseAllHeldLaunchesForTests()
    setStructuredAgentSessionHost(null)
    install()
    chatHost()
    await vi.waitFor(() => expect(faked.start).toHaveBeenCalled())
    expect(faked.start).toHaveBeenCalledWith({ marker: 'host' }, 's1')
  })

  it('drops a held chat whose Dispatch ended', async () => {
    install()
    chatHost()
    writeForkPauseAll(true, { by: 'cli' })
    void launch('s2').settled.catch(() => undefined)
    worker = undefined
    writeForkPauseAll(false, { by: 'cli' })
    await vi.waitFor(() => expect(existsSync(note())).toBe(false))
    expect(faked.start).not.toHaveBeenCalled()
  })

  it('never notes a chat that is no worker, and lets it start', async () => {
    install()
    chatHost()
    worker = undefined
    writeForkPauseAll(true, { by: 'cli' })
    expect(await launch('s3').settled).toBe('started')
    expect(existsSync(note())).toBe(false)
  })
})
