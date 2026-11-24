// Proof for COMMAND_GUARD_SURFACE_PROOFS.terminal: the terminal hook's answer denies a force push
// to the default branch and the block lands in the audit list.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FolderWorkspace } from '../../../shared/folder-workspaces/folder-workspace-types'
import { installForkWorkspaceFolders } from '../workspace-folder/workspace-folder-path'
import { listCommandGuardAudit } from './command-guards-audit'
import { forkCommandGuardAnswer, startForkCommandGuards } from './command-guards-live'
import { forkCommandGuardStatus } from './command-guards-status'

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

  it('reads a heredoc body as data, and as commands when a shell reads it (BAD-785)', () => {
    const owner = { paneKey: 'tab:1', worktreeId: `repo1::${root}`, hookEventName: 'PreToolUse' }
    const ask = (command: string): string | null =>
      forkCommandGuardAnswer('claude', body(command), owner, true)
    expect(ask("cat > notes.md <<'EOF'\nit's a `quoted` note\nEOF")).toBeNull()
    expect(ask("git commit -F - <<'EOF'\nfix: user's input\nEOF")).toBeNull()
    expect(ask("bash <<'EOF'\ngit push --force origin main\nEOF")).toContain('force-push')
    expect(ask("cat <<'EOF' | bash\ngit push --force origin main\nEOF")).toContain('force-push')
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
    const terminal = forkCommandGuardStatus([]).surfaces?.find((row) => row.surface === 'terminal')
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
    const live = ['folder:remote', 'folder:gone'].map((worktreeId) => ({
      worktreeId,
      paneKey: 'tab:3',
      agentType: 'claude'
    }))
    const terminal = forkCommandGuardStatus(live).surfaces?.find(
      (row) => row.surface === 'terminal'
    )
    expect(terminal?.guarded).toBe(false)
    expect(terminal?.note).toMatch(/^unguarded: 2 workspaces with no folder on this host/)
  })

  it('clears the terminal row once those workspaces have no live agent', () => {
    forkCommandGuardAnswer(
      'claude',
      body('git push --force origin main'),
      { paneKey: 'tab:4', worktreeId: 'folder:gone', hookEventName: 'PreToolUse' },
      true
    )
    const status = (live: { worktreeId: string; paneKey: string }[]) =>
      forkCommandGuardStatus(live).surfaces?.find((row) => row.surface === 'terminal')
    expect(status([{ worktreeId: 'folder:gone', paneKey: 'tab:4' }])?.guarded).toBe(false)
    expect(status([{ worktreeId: 'folder:notes', paneKey: 'tab:5' }])).toMatchObject({
      guarded: true,
      note: expect.stringMatching(/^Claude Code in a terminal/)
    })
  })
})
