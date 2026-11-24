// Proof for COMMAND_GUARD_SURFACE_PROOFS 'native-chat' and 'chat-worker' (BAD-764): a Claude chat
// run through the real session host, connection and Agent SDK, whose fake CLI asks the SDK's
// PreToolUse hook about a force push to the default branch. The deny reaches the CLI and the block
// is audited. command-guards-real-claude.test.ts runs the same against the real CLI.
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ensureTestStructuredAgentSessionHost as ensureStructuredAgentSessionHost } from '../../runtime/agent-session/records/agent-session-record-store-test-harness'
import { stopStructuredAgentSessionRuntime } from '../../runtime/agent-session/installation/structured-agent-session-runtime'
import {
  mintStructuredWorkerHandle,
  structuredWorkerIdentities
} from '../../runtime/orchestration/terminal-authority/structured-sessions/structured-worker-identity'
import { CLAUDE_SHELL_TOOLS } from '../../../shared/fork/command-guards-shell-tools'
import { listCommandGuardAudit } from './command-guards-audit'
import {
  askGuardChat,
  attachGuardChat,
  guardHostDeps,
  type GuardToolCall
} from './command-guards-chat.test-fixture'
import { resetCommandGuardChats } from './command-guards-chat-registry'
import { startForkCommandGuards, stopForkCommandGuards } from './command-guards-live'
import { forkCommandGuardStatus } from './command-guards-status'

type Frame = Record<string, unknown>
const asFrame = (value: unknown): Frame =>
  typeof value === 'object' && value !== null ? { ...value } : {}
const child = (value: unknown, key: string): Frame => asFrame(asFrame(value)[key])

let scratch: string
let state: string
beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'guard-chat-'))
  state = mkdtempSync(join(tmpdir(), 'guard-chat-state-'))
  execFileSync('git', ['init', '-q', '-b', 'main', scratch])
  process.env.GUARD_FAKE_ANSWER_FILE = join(scratch, 'hook-answer.jsonl')
})
afterAll(() => {
  delete process.env.GUARD_FAKE_ANSWER_FILE
  rmSync(scratch, { recursive: true, force: true })
  rmSync(state, { recursive: true, force: true })
})
beforeEach(() => {
  resetCommandGuardChats()
  structuredWorkerIdentities.clear()
  rmSync(join(scratch, 'hook-answer.jsonl'), { force: true })
  startForkCommandGuards({ requireStore: () => ({ getSettings: () => ({}), getRepos: () => [] }) })
})
afterEach(async () => {
  stopForkCommandGuards()
  await stopStructuredAgentSessionRuntime()
})

/** Runs one chat on a stand-in CLI that asks the PreToolUse hook about a force push; returns the answer. */
async function forceTheHook(
  session: string,
  workspaceId?: string,
  asked: string | GuardToolCall = 'git push --force origin main'
): Promise<unknown> {
  const host = await ensureStructuredAgentSessionHost(guardHostDeps({ state, scratch }))
  if (!host.loadedSessionIds().includes(session)) {
    await attachGuardChat(host, session, state, workspaceId)
  }
  return askGuardChat(host, session, asked)
}

describe('command guard proof: native chat', () => {
  it('denies and audits a force push to the default branch', async () => {
    const before = listCommandGuardAudit(500).length
    const reply = await forceTheHook(`chat-${randomUUID()}`)
    const output = child(reply, 'hookSpecificOutput')
    expect(output.permissionDecision).toBe('deny')
    expect(String(output.permissionDecisionReason)).toContain('command guard (force-push)')
    expect(listCommandGuardAudit(500)).toHaveLength(before + 1)
    expect(listCommandGuardAudit(1)[0]).toMatchObject({
      agent: 'claude',
      surface: 'native-chat',
      rule: 'force-push',
      command: 'git push --force origin main'
    })
    expect(
      forkCommandGuardStatus([]).surfaces?.find((row) => row.surface === 'native-chat')
    ).toMatchObject({
      guarded: true,
      chats: { guarded: 1, unguarded: 0 }
    })
  })

  it('denies and audits a force push from a chat in a folder workspace', async () => {
    const reply = await forceTheHook(`chat-${randomUUID()}`, 'folder:notes')
    expect(child(reply, 'hookSpecificOutput').permissionDecision).toBe('deny')
    expect(listCommandGuardAudit(1)[0]).toMatchObject({
      surface: 'native-chat',
      rule: 'force-push',
      workspaceId: 'folder:notes'
    })
  })

  it('lets the call of a host that never starts the guards through, and shows its chat as unguarded', async () => {
    stopForkCommandGuards(200)
    const before = listCommandGuardAudit(500).length
    const reply = await forceTheHook(`chat-${randomUUID()}`)
    expect(JSON.stringify(reply)).not.toContain('deny')
    expect(listCommandGuardAudit(500)).toHaveLength(before)
    const surface = forkCommandGuardStatus([]).surfaces?.find(
      (row) => row.surface === 'native-chat'
    )
    expect(surface).toMatchObject({ guarded: false, chats: { guarded: 0, unguarded: 1 } })
  })
})

describe('shell commands of other Claude tools in a native chat', () => {
  const force = 'git push --force origin main'

  it.each(CLAUDE_SHELL_TOOLS)('reads the command of %s', async (tool) => {
    const session = `chat-${randomUUID()}`
    const reply = await forceTheHook(session, undefined, {
      tool,
      input: { command: force, description: 'push', timeout_ms: 1000 }
    })
    expect(child(reply, 'hookSpecificOutput').permissionDecision).toBe('deny')
    expect(listCommandGuardAudit(1)[0]).toMatchObject({ rule: 'force-push', command: force })
  })

  it('lets an ordinary Monitor command, a WebSocket watch and another tool through', async () => {
    for (const call of [
      { tool: 'Monitor', input: { command: 'tail -f build.log', description: 'log' } },
      { tool: 'Monitor', input: { ws: { url: 'wss://example.com' }, description: 'feed' } },
      { tool: 'Write', input: { file_path: 'notes.md', content: force } }
    ]) {
      expect(await forceTheHook(`chat-${randomUUID()}`, undefined, call)).not.toMatchObject({
        hookSpecificOutput: { permissionDecision: 'deny' }
      })
    }
  })
})

describe('heredocs in a native chat (BAD-785)', () => {
  it('lets a heredoc with a quote in its body through', async () => {
    const before = listCommandGuardAudit(500).length
    const reply = await forceTheHook(
      `chat-${randomUUID()}`,
      undefined,
      "cat > notes.md <<'EOF'\nit's a `quoted` note\nEOF"
    )
    expect(JSON.stringify(reply)).not.toContain('deny')
    expect(listCommandGuardAudit(500)).toHaveLength(before)
  })

  it('denies a heredoc fed to bash that breaks a rule', async () => {
    const reply = await forceTheHook(
      `chat-${randomUUID()}`,
      undefined,
      "bash <<'EOF'\ngit push --force origin main\nEOF"
    )
    expect(child(reply, 'hookSpecificOutput').permissionDecision).toBe('deny')
    expect(listCommandGuardAudit(1)[0]).toMatchObject({
      rule: 'force-push',
      surface: 'native-chat'
    })
  })
})

describe('command guard proof: chat worker', () => {
  it('denies and audits a force push from a worker chat in a folder workspace', async () => {
    const session = `worker-${randomUUID()}`
    structuredWorkerIdentities.register({
      handle: mintStructuredWorkerHandle(),
      sessionId: session,
      agent: 'claude',
      paneKey: 'tab-1:leaf-1',
      processIncarnation: 'test',
      worktreeId: 'folder:notes',
      hostScope: { kind: 'local', hostId: 'local' }
    })
    const reply = await forceTheHook(session, 'folder:notes')
    expect(child(reply, 'hookSpecificOutput').permissionDecision).toBe('deny')
    expect(listCommandGuardAudit(1)[0]).toMatchObject({
      surface: 'chat-worker',
      rule: 'force-push',
      workspaceId: 'folder:notes'
    })
    const monitor = await forceTheHook(session, 'folder:notes', {
      tool: 'Monitor',
      input: { command: 'git push --force origin main' }
    })
    expect(child(monitor, 'hookSpecificOutput').permissionDecision).toBe('deny')
    expect(
      forkCommandGuardStatus([]).surfaces?.find((row) => row.surface === 'chat-worker')
    ).toMatchObject({
      guarded: true,
      chats: { guarded: 1, unguarded: 0 }
    })
  })
})
