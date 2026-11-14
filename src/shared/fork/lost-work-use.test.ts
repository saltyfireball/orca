// SLRM-2230: a workspace in use is marked and never left as safe to remove.
import { describe, expect, it } from 'vitest'
import type { LostWorkItem } from './lost-work'
import { resolveLostWorkSettings } from './lost-work'
import { annotateLostWorkUse, countedLostWorkUse, type LostWorkUse } from './lost-work-use'

const ALL = resolveLostWorkSettings(undefined).inUse

function use(over: Partial<LostWorkUse>): LostWorkUse {
  return {
    agentRunning: false,
    openChats: 0,
    sleepingChats: 0,
    liveTerminals: 0,
    active: false,
    ...over
  }
}

function item(id: string, over: Partial<LostWorkItem> = {}): LostWorkItem {
  return {
    id,
    kind: 'worktree',
    risk: 'safe',
    reasons: ['pr-merged'],
    repoId: 'r',
    repoName: 'alpha',
    worktreeId: `r::/w/${id}`,
    unmergedCommits: 0,
    unpushedCommits: 0,
    dirtyFiles: 0,
    lastCommitAt: null,
    ...over
  }
}

describe('lost work in-use settings', () => {
  it('counts every signal by default', () => {
    expect(ALL).toEqual({
      runningAgents: true,
      openChats: true,
      sleepingChats: true,
      liveTerminals: true,
      activeWorkspace: true
    })
  })

  it('ignores a signal that is switched off', () => {
    const signals = resolveLostWorkSettings({ inUse: { sleepingChats: false } }).inUse
    expect(countedLostWorkUse(use({ sleepingChats: 2 }), signals)).toBeNull()
    expect(countedLostWorkUse(use({ sleepingChats: 2, openChats: 1 }), signals)).toEqual(
      use({ openChats: 1 })
    )
  })
})

describe('annotateLostWorkUse', () => {
  it('lifts a merged workspace with a sleeping chat from safe to needs-look', () => {
    const rows = [item('busy'), item('idle')]
    const marked = annotateLostWorkUse(
      rows,
      new Map([['r::/w/busy', use({ sleepingChats: 1 })]]),
      ALL
    )
    expect(marked[0]).toMatchObject({ risk: 'needs-look', inUse: use({ sleepingChats: 1 }) })
    expect(marked[1]).toBe(rows[1])
  })

  it('keeps would-lose-work, and leaves branches and stashes alone', () => {
    const uses = new Map([['r::/w/a', use({ agentRunning: true })]])
    const [loss, branch] = annotateLostWorkUse(
      [
        item('a', { risk: 'would-lose-work' }),
        item('b', { kind: 'branch', worktreeId: undefined })
      ],
      uses,
      ALL
    )
    expect(loss.risk).toBe('would-lose-work')
    expect(loss.inUse?.agentRunning).toBe(true)
    expect(branch.inUse).toBeUndefined()
  })
})
