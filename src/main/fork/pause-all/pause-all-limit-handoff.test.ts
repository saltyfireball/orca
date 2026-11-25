// Pause all over the automatic chat handoff on a usage limit (BAD-818): the real handler that limit
// resume's changes drive, with the real switch in a temporary data folder. While paused (or with an
// unreadable switch) a parked chat is not handed off; resume-all hands off the stops still parked
// then, once. Faked: the handoff service the handler starts.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const paths = vi.hoisted(() => ({ userData: '' }))
vi.mock('../../../shared/app-lifecycle/app-environment', () => ({
  getAppEnvironment: () => ({ getPath: () => paths.userData }),
  hasAppEnvironment: () => true
}))

import type { LimitResumeEntry } from '../../../shared/fork/limit-resume'
import { limitHandoffHandler } from '../chat-handoff/chat-handoff-on-limit'
import {
  onForkPauseAllChanged,
  PAUSE_ALL_STATE_FILE_NAME,
  resetForkPauseAllCacheForTests,
  writeForkPauseAll
} from './pause-all-state'

beforeEach(() => {
  paths.userData = mkdtempSync(join(tmpdir(), 'pause-all-handoff-'))
  resetForkPauseAllCacheForTests()
})
afterEach(() => {
  rmSync(paths.userData, { recursive: true, force: true })
})

const parked = (sessionId: string): LimitResumeEntry => ({
  id: `chat:${sessionId}`,
  kind: 'chat',
  paneKey: '',
  sessionId,
  worktreeId: null,
  agent: 'claude',
  title: 'Plans',
  resetsAt: 1_000,
  resumeAt: 1_000,
  tries: 0,
  maxTries: 3,
  state: 'parked',
  line: 'usage limit'
})

function rig() {
  const start = vi.fn()
  const handler = limitHandoffHandler({
    settings: () => ({ enabled: true, onLimit: 'auto' }),
    start
  })
  onForkPauseAllChanged((state) => {
    if (!state.engaged) {
      handler.resumed()
    }
  })
  return { handler, start }
}

describe('pause all over the automatic chat handoff', () => {
  it('holds a parked chat while paused and hands it off once at resume-all', () => {
    const r = rig()
    writeForkPauseAll(true, { by: 'cli' })
    r.handler.entriesChanged([parked('s1')])
    expect(r.start).not.toHaveBeenCalled()

    writeForkPauseAll(false, { by: 'cli' })
    expect(r.start).toHaveBeenCalledTimes(1)
    expect(r.start).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1', to: 'codex' }))
    r.handler.entriesChanged([parked('s1')])
    r.handler.resumed()
    expect(r.start).toHaveBeenCalledTimes(1)
  })

  it('holds with an unreadable switch, drops a stop that ended meanwhile, and hands off when not paused', () => {
    const r = rig()
    writeFileSync(join(paths.userData, PAUSE_ALL_STATE_FILE_NAME), '{}')
    r.handler.entriesChanged([parked('s1'), parked('s2')])
    // s1 was continued by hand while paused: only s2 is still parked at resume.
    r.handler.entriesChanged([parked('s2')])
    expect(r.start).not.toHaveBeenCalled()
    writeForkPauseAll(false, { by: 'cli' })
    expect(r.start.mock.calls.map(([due]) => due.sessionId)).toEqual(['s2'])

    r.handler.entriesChanged([parked('s2'), parked('s3')])
    expect(r.start.mock.calls.map(([due]) => due.sessionId)).toEqual(['s2', 's3'])
  })
})
