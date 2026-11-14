// SLRM-2230: workspaces in use, as `orca lost-work` reads them from the runtime's rows.
import { describe, expect, it } from 'vitest'
import { lostWorkUseFromPs } from './lost-work-use-ps'

describe('lostWorkUseFromPs', () => {
  it('counts terminals, the active workspace, chats awake and asleep, and working agents', () => {
    const uses = lostWorkUseFromPs(
      [
        { worktreeId: 'w1', liveTerminalCount: 2, isActive: false },
        { worktreeId: 'w2', liveTerminalCount: 0, isActive: true },
        { worktreeId: 'w3', liveTerminalCount: 0, isActive: false },
        { worktreeId: 'w4', liveTerminalCount: 0, isActive: false }
      ],
      [
        { kind: 'chat', worktreeId: 'w3', status: 'done', processAlive: false },
        { kind: 'chat', worktreeId: 'w3', status: 'done', processAlive: true },
        { kind: 'chat', worktreeId: 'w3', status: 'working', processAlive: true },
        { kind: 'terminal', worktreeId: 'w1', status: 'blocked', processAlive: true },
        { kind: 'terminal', worktreeId: 'w4', status: 'done', processAlive: false },
        { kind: 'chat', worktreeId: null, status: 'working', processAlive: true }
      ]
    )
    expect(uses.get('w1')).toEqual({
      agentRunning: true,
      openChats: 0,
      sleepingChats: 0,
      liveTerminals: 2,
      active: false
    })
    expect(uses.get('w2')?.active).toBe(true)
    expect(uses.get('w3')).toEqual({
      agentRunning: true,
      openChats: 2,
      sleepingChats: 1,
      liveTerminals: 0,
      active: false
    })
    expect(uses.has('w4')).toBe(false)
  })
})
