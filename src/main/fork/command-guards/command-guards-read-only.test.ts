// BAD-795: a bot's look-around and tidy-up keep their own limits with the command guards on. Each
// chat runs through the real session host, launch, connection and Agent SDK; the stand-in CLI asks
// every PreToolUse hook the launch registered. command-guards-real-claude.test.ts proves that Claude
// Code itself takes the strictest of those answers, which `strictest` stands for here.
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { computeAgentSessionPayloadFingerprint } from '../../../shared/agent-session/lifecycle/operations/agent-session-mutation-envelope'
import {
  LOOK_AROUND_REFUSAL,
  REPLY_ONLY_REFUSAL,
  type ReadOnlySessionMode
} from '../../bots/bot-look-around-policy'
import {
  hostTestAttachParams,
  hostTestMessage
} from '../../native-chat/agent-session-wire/host/testing/structured-agent-session-host-test-data.test-fixture'
import { ensureTestStructuredAgentSessionHost as ensureStructuredAgentSessionHost } from '../../runtime/agent-session/records/agent-session-record-store-test-harness'
import { stopStructuredAgentSessionRuntime } from '../../runtime/agent-session/installation/structured-agent-session-runtime'
import {
  installForkMcpProfiles,
  uninstallForkMcpProfilesForTests
} from '../mcp-profiles/mcp-profiles-service'
import { listCommandGuardAudit } from './command-guards-audit'
import { resetCommandGuardChats } from './command-guards-chat-registry'
import { startForkCommandGuards, stopForkCommandGuards } from './command-guards-live'
import { forkChatGuardOptions } from './command-guards-native-chat'

const FAKE_CLAUDE = join(
  import.meta.dirname,
  'command-guards-read-only-fake-claude.test-fixture.mjs'
)

type Answer = {
  hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string }
} | null
type Run = {
  argv: string[]
  hooks: Record<string, { matcher?: string | null }[]>
  results: Answer[][]
  prompt: unknown
}

const CASES = [
  { tool: 'Write', input: { file_path: '/tmp/x', content: 'x' } },
  { tool: 'Bash', input: { command: 'touch made-it' } },
  { tool: 'mcp__notes__search', input: { query: 'x' } },
  { tool: 'Bash', input: { command: 'orca bot list' } },
  { tool: 'Bash', input: { command: 'git push --force origin main' } },
  { tool: 'Read', input: { file_path: '/tmp/x' } }
]

/** What Claude Code does with several hooks' answers: deny over ask over allow over silence. */
function strictest(answers: readonly Answer[]): string | null {
  const given = answers.map((answer) => answer?.hookSpecificOutput?.permissionDecision)
  return ['deny', 'ask', 'allow'].find((decision) => given.includes(decision)) ?? null
}

let scratch: string
beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'guard-read-only-'))
  process.env.GUARD_FAKE_CASES = join(scratch, 'cases.json')
  writeFileSync(process.env.GUARD_FAKE_CASES, JSON.stringify(CASES))
  process.env.GUARD_FAKE_OUT = join(scratch, 'run.json')
})
afterAll(() => {
  delete process.env.GUARD_FAKE_CASES
  delete process.env.GUARD_FAKE_OUT
  rmSync(scratch, { recursive: true, force: true })
})
afterEach(async () => {
  stopForkCommandGuards()
  resetCommandGuardChats()
  await stopStructuredAgentSessionRuntime()
})

async function runChat(readOnly: ReadOnlySessionMode | null, guards: boolean): Promise<Run> {
  if (guards) {
    startForkCommandGuards({
      requireStore: () => ({ getSettings: () => ({}), getRepos: () => [] })
    })
  }
  const session = `chat-${randomUUID()}`
  // One path for every run: the host reads its environment once.
  const out = join(scratch, 'run.json')
  rmSync(out, { force: true })
  const host = await ensureStructuredAgentSessionHost({
    stateDirectory: join(scratch, 'state'),
    hostId: 'local',
    claimKeyId: 'key-1',
    logger: { warn: () => {}, error: () => {} },
    resolveWorkspacePath: async () => scratch,
    resolveClaudeCommand: () => ({ command: process.execPath, prefixArgs: [FAKE_CLAUDE] }),
    resolveLaunchArgs: () => [],
    resolveClaudeAuthPolicy: () => ({ account: 'system' }),
    readOnlySession: () => readOnly
  })
  const caller = { callerKey: 'command-guards-read-only' }
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
    accountHome: { variable: 'CLAUDE_CONFIG_DIR', path: join(scratch, 'claude-home') }
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
  await vi.waitFor(() => expect(existsSync(out)).toBe(true), { timeout: 15000 })
  return JSON.parse(readFileSync(out, 'utf8'))
}

const reasons = (answers: readonly Answer[]): string =>
  answers.map((answer) => answer?.hookSpecificOutput?.permissionDecisionReason ?? '').join('\n')

describe('read-only sessions with the command guards on (BAD-795)', () => {
  it('a look-around keeps its limit and gets the guard', async () => {
    const run = await runChat('look-around', true)
    expect(run.results.map(strictest)).toEqual(['deny', 'deny', 'deny', 'allow', 'deny', 'allow'])
    expect(reasons(run.results[1])).toContain(LOOK_AROUND_REFUSAL)
    expect(reasons(run.results[4])).toContain('command guard (force-push)')
    expect(listCommandGuardAudit(1)[0]).toMatchObject({ rule: 'force-push' })
  })

  it('refuses a permission prompt of a look-around at once', async () => {
    const run = await runChat('look-around', true)
    expect(run.prompt).toEqual({
      behavior: 'deny',
      message: LOOK_AROUND_REFUSAL,
      toolUseID: 'prompt-1'
    })
  })

  it('a tidy-up keeps its hook, no tools, no MCP servers and its settings', async () => {
    const run = await runChat('reply-only', true)
    expect(run.results.map(strictest)).toEqual(CASES.map(() => 'deny'))
    expect(reasons(run.results[3])).toContain(REPLY_ONLY_REFUSAL)
    expect(run.argv.filter((arg) => arg.startsWith('--tools'))).toEqual(['--tools='])
    expect(run.argv).toContain('--strict-mcp-config')
    const settings = run.argv.find((arg) => arg.includes('disableAllHooks')) ?? ''
    expect(settings).toContain('"disableAllHooks":true')
    expect(run.prompt).toMatchObject({ behavior: 'deny', message: REPLY_ONLY_REFUSAL })
  })

  it('an MCP profile narrows a normal chat and brings no server back into a tidy-up', async () => {
    await installForkMcpProfiles({
      readSettings: () => ({
        forkMcpProfiles: [{ name: 'web', mode: 'allow', servers: ['browser'] }],
        forkMcpDefaultInteractive: 'web'
      }),
      dataFolder: join(scratch, 'mcp'),
      chatStateFile: null
    })
    const mcpConfigs = (run: Run) => run.argv.filter((arg) => arg.startsWith('--mcp-config'))
    try {
      expect(mcpConfigs(await runChat(null, true))).toHaveLength(1)
      await stopStructuredAgentSessionRuntime()
      const tidyUp = await runChat('reply-only', true)
      expect(mcpConfigs(tidyUp)).toEqual([])
      expect(tidyUp.argv).toContain('--strict-mcp-config')
    } finally {
      uninstallForkMcpProfilesForTests()
    }
  })

  it('a normal chat has the guard alone, and its prompt waits for the owner', async () => {
    const run = await runChat(null, true)
    expect(run.results.map(strictest)).toEqual([null, null, null, null, 'deny', null])
    expect(run.hooks.PreToolUse).toHaveLength(1)
    expect(run.prompt).toBe('waiting')
  })

  it('with the guards off a look-around has its own hook and a normal chat none', async () => {
    const look = await runChat('look-around', false)
    expect(look.results.map(strictest)).toEqual(['deny', 'deny', 'deny', 'allow', 'deny', 'allow'])
    expect(look.hooks.PreToolUse).toHaveLength(1)
    await stopStructuredAgentSessionRuntime()
    const chat = await runChat(null, false)
    expect(chat.results.map(strictest)).toEqual(CASES.map(() => null))
  })
})

it('keeps every event and matcher the options already have', () => {
  startForkCommandGuards({ requireStore: () => ({ getSettings: () => ({}), getRepos: () => [] }) })
  const silent = async () => ({})
  const hooks: NonNullable<Options['hooks']> = {
    PreToolUse: [{ matcher: 'Write', hooks: [silent], onFailure: 'block' }, { hooks: [silent] }],
    Stop: [{ hooks: [silent] }],
    PostToolUse: [{ matcher: 'Bash', hooks: [silent], timeout: 5 }]
  }
  const given = structuredClone(Object.keys(hooks))
  const guarded = forkChatGuardOptions({ hooks, model: 'haiku' }, 'sess-keeps', scratch)
  expect(guarded.hooks?.PreToolUse).toEqual([
    ...(hooks.PreToolUse ?? []),
    expect.objectContaining({ matcher: 'Bash', onFailure: 'continue' })
  ])
  expect(guarded.hooks?.Stop).toBe(hooks.Stop)
  expect(guarded.hooks?.PostToolUse).toBe(hooks.PostToolUse)
  expect(guarded.model).toBe('haiku')
  // The caller's own object is not changed.
  expect(Object.keys(hooks)).toEqual(given)
  expect(hooks.PreToolUse).toHaveLength(2)
})
