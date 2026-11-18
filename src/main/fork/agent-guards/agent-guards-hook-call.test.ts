import { describe, expect, it } from 'vitest'
import { agentGuardOutputFailure, readAgentGuardHookCall } from './agent-guards-hook-call'
import { parseAgentGuardRecords } from './agent-guards-state'

const owner = (hookEventName: string) => ({
  paneKey: 'tab1:pane1',
  worktreeId: 'wt',
  hookEventName
})

describe('readAgentGuardHookCall', () => {
  it("reads Claude Code's PostToolUseFailure as a failed call with its error", () => {
    const body = {
      payload: JSON.stringify({
        tool_name: 'Bash',
        tool_input: { command: 'npm test' },
        error: 'Exit code 1\nFAIL'
      })
    }
    const read = readAgentGuardHookCall('claude', body, owner('PostToolUseFailure'), 42)
    expect(read).toMatchObject({
      paneKey: 'tab1:pane1',
      agent: 'claude',
      call: { tool: 'Bash', failed: true, error: 'Exit code 1\nFAIL', at: 42 }
    })
  })

  it('a successful PostToolUse is not a failure, and a before-tool event is nothing', () => {
    const body = {
      payload: { tool_name: 'Edit', tool_input: { file_path: 'a' }, tool_response: { ok: true } }
    }
    expect(readAgentGuardHookCall('claude', body, owner('PostToolUse'), 1)?.call.failed).toBe(false)
    expect(readAgentGuardHookCall('claude', body, owner('PreToolUse'), 1)).toBeNull()
  })

  it('a call the person interrupted is not counted', () => {
    const body = { payload: { tool_name: 'Bash', tool_input: {}, error: 'x', is_interrupt: true } }
    expect(readAgentGuardHookCall('claude', body, owner('PostToolUseFailure'), 1)).toBeNull()
  })
})

describe('agentGuardOutputFailure', () => {
  it('reads exit codes and error flags', () => {
    expect(agentGuardOutputFailure({ exit_code: 2, stderr: 'boom' })).toEqual({
      failed: true,
      error: 'boom'
    })
    expect(agentGuardOutputFailure({ is_error: true, content: 'nope' }).failed).toBe(true)
    expect(agentGuardOutputFailure('Exit code: 1\nWall time: 2s\nerror').failed).toBe(true)
    expect(agentGuardOutputFailure('Exit code: 0\nok').failed).toBe(false)
    expect(agentGuardOutputFailure({ stdout: 'error words but fine' }).failed).toBe(false)
  })
})

describe('parseAgentGuardRecords', () => {
  it('keeps valid records and drops malformed ones', () => {
    const records = parseAgentGuardRecords(
      JSON.stringify({
        version: 1,
        agents: {
          s1: {
            kind: 'chat',
            agent: 'claude',
            title: 'w\u0007x',
            worktreeId: 'wt',
            paused: { reason: 'spend', at: 5, spentUsd: 6, capUsd: 5 },
            capUsd: 5,
            at: 5
          },
          s2: { kind: 'robot', at: 1 },
          s3: { kind: 'chat', paused: { reason: 'other', at: 1 }, capUsd: -1, at: 1 }
        }
      })
    )
    expect([...records.keys()]).toEqual(['s1', 's3'])
    expect(records.get('s1')).toMatchObject({
      title: 'w x',
      paused: { reason: 'spend' },
      capUsd: 5
    })
    expect(records.get('s3')?.paused).toBeUndefined()
    expect(records.get('s3')?.capUsd).toBeUndefined()
  })
})
