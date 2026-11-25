// @orca-isolated-worker the install runs once per process.
// Pause all over the automatic chat handoff on a usage limit (BAD-818), as the host starts it: the
// real install over the real switch, so resume-all reaches the held handoff. Faked: the limit
// resume list and the handoff service.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const faked = vi.hoisted(() => ({
  userData: '',
  changed: null as ((entries: unknown[]) => void) | null,
  start: vi.fn(async () => ({ status: 'started' }))
}))
vi.mock('../../../shared/app-lifecycle/app-environment', () => ({
  getAppEnvironment: () => ({ getPath: () => faked.userData }),
  hasAppEnvironment: () => true
}))
vi.mock('../limit-resume/limit-resume-service', () => ({
  onForkLimitResumeChanged: (listener: (entries: unknown[]) => void) => {
    faked.changed = listener
  }
}))
vi.mock('../chat-handoff/chat-handoff-host', () => ({
  chatHandoffSettingsOf: () => ({ enabled: true, onLimit: 'auto' }),
  forkChatHandoffService: async () => ({ start: faked.start })
}))

import { startForkChatHandoffOnLimit } from '../chat-handoff/chat-handoff-on-limit'
import { resetForkPauseAllCacheForTests, writeForkPauseAll } from './pause-all-state'

beforeEach(() => {
  faked.userData = mkdtempSync(join(tmpdir(), 'pause-all-handoff-start-'))
  resetForkPauseAllCacheForTests()
})
afterEach(() => {
  rmSync(faked.userData, { recursive: true, force: true })
})

it('hands off a held stop once resume-all releases the switch', async () => {
  // The start does nothing under a test runner unless told otherwise.
  vi.stubEnv('VITEST', '')
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: every reader of the runtime is faked.
  startForkChatHandoffOnLimit({} as never)
  vi.unstubAllEnvs()
  writeForkPauseAll(true, { by: 'cli' })
  faked.changed!([
    {
      id: 'chat:s1',
      kind: 'chat',
      paneKey: '',
      sessionId: 's1',
      worktreeId: null,
      agent: 'claude',
      title: 'Plans',
      resetsAt: 1_000,
      resumeAt: 1_000,
      tries: 0,
      maxTries: 3,
      state: 'parked',
      line: 'usage limit'
    }
  ])
  await new Promise((resolve) => setTimeout(resolve, 5))
  expect(faked.start).not.toHaveBeenCalled()
  writeForkPauseAll(false, { by: 'cli' })
  await vi.waitFor(() => expect(faked.start).toHaveBeenCalledTimes(1))
  expect(faked.start).toHaveBeenCalledWith({ sessionId: 's1', to: 'codex' })
})
