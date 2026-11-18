import { describe, expect, it } from 'vitest'
import {
  agentGuardCapFor,
  agentGuardReadOnlyCommand,
  agentGuardSignature,
  classifyAgentGuardCall,
  newAgentGuardLoopTrack,
  normalizeAgentGuardEntries,
  normalizeAgentGuardError,
  noteAgentGuardWarned,
  readAgentGuardSettings,
  stepAgentGuardLoop,
  type AgentGuardToolCall
} from './agent-guards'

const settings = { repeats: 3, pauseAfterWarning: true }

function fail(at: number, error = 'Exit code 1\nFAIL src/a.test.ts'): AgentGuardToolCall {
  return { tool: 'Bash', input: { command: 'npm test' }, failed: true, error, at }
}

describe('readAgentGuardSettings', () => {
  it('defaults: loop guard on at 6 repeats with a pause, spend cap off for workers, notify on', () => {
    expect(readAgentGuardSettings(undefined)).toEqual({
      loop: true,
      repeats: 6,
      pauseAfterWarning: true,
      capUsd: 0,
      capScope: 'workers',
      notify: true
    })
  })

  it('refuses values out of range', () => {
    const read = readAgentGuardSettings({
      forkAgentGuardLoopRepeats: 1,
      forkAgentGuardSpendCapUsd: -5,
      forkAgentGuardSpendCapScope: 'everyone'
    })
    expect(read.repeats).toBe(6)
    expect(read.capUsd).toBe(0)
    expect(read.capScope).toBe('workers')
    expect(readAgentGuardSettings({ forkAgentGuardSpendCapUsd: 2.555 }).capUsd).toBe(2.56)
  })
})

describe('classifyAgentGuardCall', () => {
  it('reads and waits are neutral, failures fail, other successes are progress', () => {
    expect(classifyAgentGuardCall({ tool: 'Read', input: {}, failed: true })).toBe('neutral')
    expect(
      classifyAgentGuardCall({
        tool: 'Bash',
        input: { command: 'rg foo src | head' },
        failed: false
      })
    ).toBe('neutral')
    expect(
      classifyAgentGuardCall({ tool: 'Bash', input: { command: 'gh pr checks 12' }, failed: true })
    ).toBe('neutral')
    expect(
      classifyAgentGuardCall({
        tool: 'shell',
        input: { command: ['bash', '-lc', 'git status'] },
        failed: false
      })
    ).toBe('neutral')
    expect(
      classifyAgentGuardCall({ tool: 'Bash', input: { command: 'npm test' }, failed: true })
    ).toBe('failed')
    expect(classifyAgentGuardCall({ tool: 'Edit', input: {}, failed: false })).toBe('progress')
  })

  it('never takes a command that may write for a read', () => {
    expect(agentGuardReadOnlyCommand('cat a > b')).toBe(false)
    expect(agentGuardReadOnlyCommand("sed -i 's/a/b/' f")).toBe(false)
    expect(agentGuardReadOnlyCommand('find . -delete')).toBe(false)
    expect(agentGuardReadOnlyCommand('git diff --output=x')).toBe(false)
    expect(agentGuardReadOnlyCommand('git push')).toBe(false)
    expect(agentGuardReadOnlyCommand('cat $(rm -rf x)')).toBe(false)
    expect(agentGuardReadOnlyCommand('sed -n 1,20p f 2>/dev/null && ls')).toBe(true)
  })
})

describe('signature', () => {
  it('ignores numbers, ids and colors in the error, not the input', () => {
    expect(normalizeAgentGuardError('\x1b[31mFailed\x1b[0m in 123ms  (pid 4567)')).toBe(
      'failed in #ms (pid #)'
    )
    expect(agentGuardSignature(fail(1, 'took 10ms'))).toBe(
      agentGuardSignature(fail(2, 'took 99ms'))
    )
    expect(agentGuardSignature(fail(1))).not.toBe(
      agentGuardSignature({ ...fail(1), input: { command: 'npm run lint' } })
    )
    expect(agentGuardSignature({ ...fail(1), input: { b: 1, a: 2 } })).toBe(
      agentGuardSignature({ ...fail(1), input: { a: 2, b: 1 } })
    )
  })
})

describe('stepAgentGuardLoop', () => {
  it('warns at the repeat count, with reads between tries not clearing the run', () => {
    const track = newAgentGuardLoopTrack()
    expect(stepAgentGuardLoop(track, fail(1), settings).kind).toBe('none')
    stepAgentGuardLoop(
      track,
      { tool: 'Read', input: {}, failed: false, error: '', at: 2 },
      settings
    )
    expect(stepAgentGuardLoop(track, fail(3), settings).kind).toBe('none')
    const action = stepAgentGuardLoop(track, fail(4), settings)
    expect(action).toMatchObject({ kind: 'warn', count: 3, tool: 'Bash' })
  })

  it('a call that did something and worked starts over', () => {
    const track = newAgentGuardLoopTrack()
    stepAgentGuardLoop(track, fail(1), settings)
    stepAgentGuardLoop(track, fail(2), settings)
    stepAgentGuardLoop(
      track,
      { tool: 'Edit', input: {}, failed: false, error: '', at: 3 },
      settings
    )
    expect(stepAgentGuardLoop(track, fail(4), settings).kind).toBe('none')
  })

  it('pauses only on a failure after the warning went out, and only when pausing is on', () => {
    const track = newAgentGuardLoopTrack()
    for (const at of [1, 2]) {
      stepAgentGuardLoop(track, fail(at), settings)
    }
    const warn = stepAgentGuardLoop(track, fail(3), settings)
    expect(warn.kind).toBe('warn')
    if (warn.kind !== 'warn') {
      return
    }
    noteAgentGuardWarned(track, warn, 10)
    // A failure that finished before the warning was sent does not count.
    expect(stepAgentGuardLoop(track, fail(9), settings).kind).toBe('none')
    expect(
      stepAgentGuardLoop(track, fail(11), { ...settings, pauseAfterWarning: false }).kind
    ).toBe('none')
    expect(stepAgentGuardLoop(track, fail(12), settings)).toMatchObject({ kind: 'pause' })
  })

  it('a different failing call after the warning does not pause', () => {
    const track = newAgentGuardLoopTrack()
    noteAgentGuardWarned(
      track,
      { signature: agentGuardSignature(fail(1)), count: 3, tool: 'Bash' },
      5
    )
    expect(stepAgentGuardLoop(track, fail(6, 'another error'), settings).kind).toBe('none')
  })
})

describe('agentGuardCapFor', () => {
  const on = { capUsd: 5, capScope: 'workers' as const }
  it('a chat of its own wins; the default covers workers unless the scope is all', () => {
    expect(agentGuardCapFor(2, false, on)).toBe(2)
    expect(agentGuardCapFor(undefined, true, on)).toBe(5)
    expect(agentGuardCapFor(undefined, false, on)).toBeNull()
    expect(agentGuardCapFor(undefined, false, { ...on, capScope: 'all' })).toBe(5)
    expect(agentGuardCapFor(undefined, true, { ...on, capUsd: 0 })).toBeNull()
  })
})

describe('normalizeAgentGuardEntries', () => {
  it('drops malformed entries', () => {
    expect(
      normalizeAgentGuardEntries([
        { id: 'a', kind: 'chat', state: 'paused', title: 'x' },
        { id: 'b', kind: 'robot', state: 'paused', title: 'x' },
        null
      ])
    ).toHaveLength(1)
    expect(normalizeAgentGuardEntries('nope')).toEqual([])
  })
})
