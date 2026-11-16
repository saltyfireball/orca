import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionRestartActivity } from '../../../shared/agent-session/lifecycle/stopping/agent-session-restart-activity'
import type { StructuredAgentSessionResumeCandidate } from '../../native-chat/agent-session-wire/recovery/structured-agent-session-restart-resume-set'
import {
  runUnattendedResumePass,
  UNATTENDED_RESUME_OWNER,
  type UnattendedResumeDeps
} from './unattended-resume-service'
import {
  parseUnattendedResumeTries,
  readUnattendedResumeTries,
  unattendedResumeTriesPath,
  writeUnattendedResumeTries,
  type UnattendedResumeTries
} from './unattended-resume-tries'

const WORKING: AgentSessionRestartActivity = { state: 'working', prompts: [], tasks: [] }

function candidate(
  sessionId: string,
  activity: AgentSessionRestartActivity | undefined = WORKING
): StructuredAgentSessionResumeCandidate {
  const base: StructuredAgentSessionResumeCandidate = {
    sessionId,
    workspaceId: 'ws',
    agent: 'claude',
    work: { kind: 'turn', id: `turn-${sessionId}` },
    trigger: 'update',
    recordedAt: 1000,
    latestPrompt: '',
    executionHostId: 'local',
    workspaceKind: 'git-worktree'
  }
  return activity ? { ...base, activity } : base
}

/** A data folder in memory: the tries persist across passes the way the file does. */
function rig(
  candidates: StructuredAgentSessionResumeCandidate[],
  kinds: Record<string, 'worker' | 'automation' | null>,
  settings: Record<string, unknown> = {}
) {
  let saved: UnattendedResumeTries = new Map()
  const continueAfterRestart = vi.fn(async (sessionIds: readonly string[]) => ({
    resumed: [],
    continued: sessionIds.map((sessionId) => ({ sessionId, outcome: 'continued' as const }))
  }))
  const host = vi.fn(async () => ({ list: async () => candidates, continueAfterRestart }))
  const deps: UnattendedResumeDeps = {
    settings: () => settings,
    listMarkers: async () => candidates.map(({ sessionId }) => ({ sessionId })),
    host,
    classify: (entry) => kinds[entry.sessionId] ?? null,
    readTries: async () => new Map(saved),
    writeTries: (tries) => {
      saved = new Map(tries)
    },
    now: () => 5000,
    log: () => {}
  }
  return { deps, host, continueAfterRestart, tries: () => saved }
}

describe('runUnattendedResumePass', () => {
  it('continues unattended chats and leaves interactive ones to the offer', async () => {
    const { deps, continueAfterRestart, tries } = rig(
      [candidate('worker'), candidate('automation'), candidate('person')],
      { worker: 'worker', automation: 'automation', person: null }
    )
    const result = await runUnattendedResumePass(deps)
    expect(continueAfterRestart).toHaveBeenCalledWith(
      ['worker', 'automation'],
      UNATTENDED_RESUME_OWNER
    )
    expect(result.decisions.find((entry) => entry.sessionId === 'person')?.decision).toEqual({
      action: 'skip',
      reason: 'interactive'
    })
    expect(tries().get('worker')).toEqual({ tries: 1, lastTryAt: 5000 })
    expect(tries().has('person')).toBe(false)
  })

  it('never continues a worker that was waiting on an approval', async () => {
    const { deps, continueAfterRestart } = rig(
      [
        candidate('asks', {
          state: 'working',
          prompts: [{ kind: 'approval', label: 'Bash' }],
          tasks: []
        })
      ],
      { asks: 'worker' }
    )
    await runUnattendedResumePass(deps)
    expect(continueAfterRestart).not.toHaveBeenCalled()
  })

  it('stops a crash loop at the cap, counting each try before it is sent', async () => {
    const { deps, continueAfterRestart, tries } = rig([candidate('loop')], { loop: 'worker' })
    continueAfterRestart.mockImplementationOnce(async () => {
      // The count is already on disk when the send starts.
      expect(tries().get('loop')?.tries).toBe(1)
      throw new Error('crashed mid-send')
    })
    await expect(runUnattendedResumePass(deps)).rejects.toThrow('crashed mid-send')
    await runUnattendedResumePass(deps)
    await runUnattendedResumePass(deps)
    expect(tries().get('loop')?.tries).toBe(3)
    const fourth = await runUnattendedResumePass(deps)
    expect(continueAfterRestart).toHaveBeenCalledTimes(3)
    expect(fourth.decisions[0]?.decision).toEqual({ action: 'skip', reason: 'tries-used' })
  })

  it('honors a lower cap from settings', async () => {
    const { deps, continueAfterRestart } = rig(
      [candidate('one')],
      { one: 'automation' },
      {
        forkUnattendedResumeMaxTries: 1
      }
    )
    await runUnattendedResumePass(deps)
    await runUnattendedResumePass(deps)
    expect(continueAfterRestart).toHaveBeenCalledTimes(1)
  })

  it('ends a streak once a start finds no cut turn for the chat', async () => {
    const { deps, tries } = rig([], {})
    deps.readTries = async () => new Map([['done', { tries: 3, lastTryAt: 1 }]])
    await runUnattendedResumePass(deps)
    expect(tries().has('done')).toBe(false)
  })

  it('installs no chat host when nothing was cut, and nothing at all when off', async () => {
    const empty = rig([], {})
    await runUnattendedResumePass(empty.deps)
    expect(empty.host).not.toHaveBeenCalled()
    const off = rig([candidate('w')], { w: 'worker' }, { forkUnattendedResume: false })
    await runUnattendedResumePass(off.deps)
    expect(off.host).not.toHaveBeenCalled()
    expect(off.continueAfterRestart).not.toHaveBeenCalled()
  })
})

describe('unattended resume tries file', () => {
  let dir: string | null = null
  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
      dir = null
    }
  })

  it('round-trips through the data folder', async () => {
    dir = mkdtempSync(join(tmpdir(), 'fork-unattended-resume-'))
    const path = unattendedResumeTriesPath(dir)
    expect((await readUnattendedResumeTries(path)).size).toBe(0)
    writeUnattendedResumeTries(path, new Map([['chat', { tries: 2, lastTryAt: 9 }]]))
    expect((await readUnattendedResumeTries(path)).get('chat')).toEqual({ tries: 2, lastTryAt: 9 })
  })

  it('starts empty on a broken file and drops bad entries', async () => {
    dir = mkdtempSync(join(tmpdir(), 'fork-unattended-resume-'))
    const path = unattendedResumeTriesPath(dir)
    writeFileSync(path, '{not json')
    expect((await readUnattendedResumeTries(path)).size).toBe(0)
    const parsed = parseUnattendedResumeTries(
      JSON.stringify({
        sessions: { good: { tries: 1, lastTryAt: 2 }, zero: { tries: 0 }, text: { tries: '3' } }
      })
    )
    expect([...parsed.keys()]).toEqual(['good'])
  })
})
