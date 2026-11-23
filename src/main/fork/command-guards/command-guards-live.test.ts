// Proof for COMMAND_GUARD_SURFACE_PROOFS.terminal: the terminal hook's answer denies a force push
// to the default branch and the block lands in the audit list.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listCommandGuardAudit } from './command-guards-audit'
import {
  forkCommandGuardAnswer,
  forkCommandGuardStatus,
  startForkCommandGuards
} from './command-guards-live'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'guard-live-'))
  mkdirSync(join(root, '.git'))
  writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n')
  startForkCommandGuards({
    requireStore: () => ({ getSettings: () => ({}), getRepos: () => [] })
  })
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

const body = (command: string): unknown => ({
  payload: { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }
})

describe('command guard proof: terminal', () => {
  it('denies a force push to the default branch and audits it', () => {
    const before = listCommandGuardAudit(500).length
    const answer = forkCommandGuardAnswer(
      'claude',
      body('git push --force origin main'),
      { paneKey: 'tab:1', worktreeId: `repo1::${root}`, hookEventName: 'PreToolUse' },
      true
    )
    expect(JSON.parse(answer ?? '{}').hookSpecificOutput.permissionDecision).toBe('deny')
    expect(listCommandGuardAudit(500)).toHaveLength(before + 1)
    expect(listCommandGuardAudit(1)[0]).toMatchObject({ agent: 'claude', rule: 'force-push' })
  })

  it('lets a script that does not read the answer through', () => {
    const answer = forkCommandGuardAnswer(
      'claude',
      body('git push --force origin main'),
      { paneKey: 'tab:1', worktreeId: `repo1::${root}`, hookEventName: 'PreToolUse' },
      false
    )
    expect(answer).toBeNull()
  })

  it('reports the terminal as guarded only because this test exists', () => {
    const terminal = forkCommandGuardStatus().surfaces?.find((row) => row.surface === 'terminal')
    expect(terminal).toMatchObject({
      guarded: true,
      proof: 'src/main/fork/command-guards/command-guards-live.test.ts'
    })
  })
})
