// Proof for COMMAND_GUARD_SURFACE_PROOFS 'native-chat' and 'chat-worker' (BAD-764): a Claude chat
// run through the real session host, connection and Agent SDK, whose fake CLI asks the SDK's
// PreToolUse hook about a force push to the default branch. The deny reaches the CLI and the block
// is audited. command-guards-real-claude.test.ts runs the same against the real CLI.
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeAgentSessionPayloadFingerprint } from '../../../shared/agent-session/lifecycle/operations/agent-session-mutation-envelope'
import {
  HOST_TEST_LOCATION,
  hostTestAttachParams,
  hostTestMessage
} from '../../native-chat/agent-session-wire/host/testing/structured-agent-session-host-test-data.test-fixture'
import { ensureTestStructuredAgentSessionHost as ensureStructuredAgentSessionHost } from '../../runtime/agent-session/records/agent-session-record-store-test-harness'
import { stopStructuredAgentSessionRuntime } from '../../runtime/agent-session/installation/structured-agent-session-runtime'
import {
  mintStructuredWorkerHandle,
  structuredWorkerIdentities
} from '../../runtime/orchestration/terminal-authority/structured-sessions/structured-worker-identity'
const FAKE_CLAUDE = join(import.meta.dirname, 'command-guards-fake-claude.test-fixture.mjs')

import { listCommandGuardAudit } from './command-guards-audit'
import { resetCommandGuardChats } from './command-guards-chat-registry'
import {
  forkCommandGuardStatus,
  startForkCommandGuards,
  stopForkCommandGuards
} from './command-guards-live'

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
  command = 'git push --force origin main'
): Promise<unknown> {
  writeFileSync(`${process.env.GUARD_FAKE_ANSWER_FILE}.command`, command)
  const host = await ensureStructuredAgentSessionHost({
    stateDirectory: state,
    hostId: 'local',
    claimKeyId: 'key-1',
    logger: { warn: () => {}, error: () => {} },
    resolveWorkspacePath: async () => scratch,
    resolveClaudeCommand: () => ({ command: process.execPath, prefixArgs: [FAKE_CLAUDE] }),
    resolveLaunchArgs: () => [],
    resolveClaudeAuthPolicy: () => ({ account: 'system' })
  })
  const caller = { callerKey: 'command-guards-proof' }
  const params = hostTestAttachParams(null, {
    envelope: {
      sessionId: session,
      clientOperationId: `${Date.now()}-${'1'.padStart(32, '0')}`,
      expectedRuntimeFence: null,
      payloadFingerprint: ''
    },
    provider: 'claude',
    agent: 'claude',
    providerHandle: { kind: 'claude', sessionId: randomUUID(), leafUuid: null },
    accountHome: { variable: 'CLAUDE_CONFIG_DIR', path: join(state, 'claude-home') },
    ...(workspaceId
      ? { location: { ...HOST_TEST_LOCATION, workspaceId, workspaceKind: 'folder' as const } }
      : {})
  })
  expect(await host.attach(caller, params)).toMatchObject({ ok: true })
  await vi.waitFor(
    () => expect(host.readStatusSummary(session)?.hostExecutionPhase).toBe('ready'),
    { timeout: 15000 }
  )
  const body = hostTestMessage('go')
  await host.send(caller, {
    body,
    envelope: {
      sessionId: session,
      clientOperationId: `${Date.now()}-${'2'.padStart(32, '0')}`,
      expectedRuntimeFence: host.deps.store.getRecord(session)!.lease.runtimeFence,
      payloadFingerprint: computeAgentSessionPayloadFingerprint({
        method: 'agentSession.send',
        sessionId: session,
        fields: { body }
      })
    }
  })
  const file = process.env.GUARD_FAKE_ANSWER_FILE!
  await vi.waitFor(() => expect(existsSync(file)).toBe(true), { timeout: 15000 })
  return JSON.parse(readFileSync(file, 'utf8').trim().split('\n')[0])
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

  it('shows a chat started with no guard endpoint as unguarded', async () => {
    stopForkCommandGuards()
    const before = listCommandGuardAudit(500).length
    const reply = await forceTheHook(`chat-${randomUUID()}`)
    expect(reply).toBeNull()
    expect(listCommandGuardAudit(500)).toHaveLength(before)
    const surface = forkCommandGuardStatus([]).surfaces?.find(
      (row) => row.surface === 'native-chat'
    )
    expect(surface).toMatchObject({ guarded: false, chats: { guarded: 0, unguarded: 1 } })
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
    expect(
      forkCommandGuardStatus([]).surfaces?.find((row) => row.surface === 'chat-worker')
    ).toMatchObject({
      guarded: true,
      chats: { guarded: 1, unguarded: 0 }
    })
  })
})
