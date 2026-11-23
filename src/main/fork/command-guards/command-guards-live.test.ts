// Proof for COMMAND_GUARD_SURFACE_PROOFS.terminal: the terminal hook's answer denies a force push
// to the default branch and the block lands in the audit list.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FolderWorkspace } from '../../../shared/folder-workspaces/folder-workspace-types'
import { installForkWorkspaceFolders } from '../workspace-folder/workspace-folder-path'
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
  const folders: Record<string, Partial<FolderWorkspace>> = {
    notes: { id: 'notes', folderPath: root, projectGroupId: 'group-1' },
    remote: { id: 'remote', folderPath: root, projectGroupId: 'group-1', connectionId: 'ssh-1' }
  }
  installForkWorkspaceFolders({
    requireStore: () => ({
      getFolderWorkspace: (id) => folders[id] as FolderWorkspace | undefined,
      getProjectGroups: () => []
    })
  })
})

afterEach(() => {
  installForkWorkspaceFolders(null)
  rmSync(root, { recursive: true, force: true })
})

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

describe('command guard proof: terminal in a folder workspace', () => {
  it('denies a force push to the default branch from a folder workspace and audits it', () => {
    const before = listCommandGuardAudit(500).length
    const answer = forkCommandGuardAnswer(
      'claude',
      body('git push --force origin main'),
      { paneKey: 'tab:2', worktreeId: 'folder:notes', hookEventName: 'PreToolUse' },
      true
    )
    expect(JSON.parse(answer ?? '{}').hookSpecificOutput.permissionDecision).toBe('deny')
    expect(listCommandGuardAudit(500)).toHaveLength(before + 1)
    expect(listCommandGuardAudit(1)[0]).toMatchObject({
      rule: 'force-push',
      surface: 'terminal',
      workspaceId: 'folder:notes'
    })
  })

  // Runs last: it marks the terminal surface unguarded for the rest of this process.
  it('lets a folder workspace with no folder here through and says so in the status', () => {
    for (const worktreeId of ['folder:remote', 'folder:gone']) {
      const answer = forkCommandGuardAnswer(
        'claude',
        body('git push --force origin main'),
        { paneKey: 'tab:3', worktreeId, hookEventName: 'PreToolUse' },
        true
      )
      expect(answer).toBeNull()
    }
    const terminal = forkCommandGuardStatus().surfaces?.find((row) => row.surface === 'terminal')
    expect(terminal?.guarded).toBe(false)
    expect(terminal?.note).toMatch(/^unguarded: 2 workspaces with no folder on this host/)
  })
})
