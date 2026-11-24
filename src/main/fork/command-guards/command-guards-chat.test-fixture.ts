// A Claude chat for the command guard tests (BAD-764), through the real session host, launch,
// connection and Agent SDK, on the stand-in CLI. Used in the test's own process and, for a chat that
// outlives its app, in a child process that is one app instance
// (command-guards-app-instance.test-fixture.ts), so nothing here may import vitest.
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { computeAgentSessionPayloadFingerprint } from '../../../shared/agent-session/lifecycle/operations/agent-session-mutation-envelope'
import type { ReadOnlySessionMode } from '../../bots/bot-look-around-policy'
import type { StructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-host'
import {
  HOST_TEST_LOCATION,
  hostTestAttachParams,
  hostTestMessage
} from '../../native-chat/agent-session-wire/host/testing/structured-agent-session-host-test-data.test-fixture'
import type { StructuredAgentSessionRuntimeDeps } from '../../runtime/agent-session/installation/structured-agent-session-runtime-contract'

const FAKE_CLAUDE = join(import.meta.dirname, 'command-guards-fake-claude.test-fixture.mjs')
const CALLER = { callerKey: 'command-guards-proof' }

/** The host's deps on the stand-in CLI; `node` runs it (the test's own runtime may be another). */
export function guardHostDeps(input: {
  state: string
  scratch: string
  node?: string
  readOnly?: ReadOnlySessionMode | null
}): StructuredAgentSessionRuntimeDeps {
  return {
    stateDirectory: input.state,
    hostId: 'local',
    claimKeyId: 'key-1',
    logger: { warn: () => {}, error: () => {} },
    resolveWorkspacePath: async () => input.scratch,
    resolveClaudeCommand: () => ({
      command: input.node ?? process.execPath,
      prefixArgs: [FAKE_CLAUDE]
    }),
    resolveLaunchArgs: () => [],
    resolveClaudeAuthPolicy: () => ({ account: 'system' }),
    ...(input.readOnly ? { readOnlySession: () => input.readOnly ?? null } : {})
  }
}

async function until(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 20_000
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out: ${what}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

let operations = 0
function operationId(): string {
  operations += 1
  return `${Date.now()}-${(process.pid * 1000 + operations).toString(16).padStart(32, '0')}`
}

export async function attachGuardChat(
  host: StructuredAgentSessionHost,
  session: string,
  state: string,
  workspaceId?: string
): Promise<void> {
  const params = hostTestAttachParams(null, {
    envelope: {
      sessionId: session,
      clientOperationId: operationId(),
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
  const attached = await host.attach(CALLER, params)
  if (!attached.ok) {
    throw new Error(`attach: ${JSON.stringify(attached)}`)
  }
  await guardChatReady(host, session)
}

export function guardChatReady(host: StructuredAgentSessionHost, session: string): Promise<void> {
  return until(
    () => host.readStatusSummary(session)?.hostExecutionPhase === 'ready',
    `chat ${session} ready`
  )
}

const lines = (file: string): string[] =>
  existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean) : []

/** Sends a message without waiting for the hook's answer. */
export async function sendGuardChat(
  host: StructuredAgentSessionHost,
  session: string,
  command: string
): Promise<() => Promise<unknown>> {
  const file = process.env.GUARD_FAKE_ANSWER_FILE ?? ''
  writeFileSync(`${file}.command`, command)
  const before = lines(file).length
  const body = hostTestMessage('go')
  await host.send(CALLER, {
    body,
    envelope: {
      sessionId: session,
      clientOperationId: operationId(),
      expectedRuntimeFence: host.deps.store.getRecord(session)?.lease.runtimeFence ?? null,
      payloadFingerprint: computeAgentSessionPayloadFingerprint({
        method: 'agentSession.send',
        sessionId: session,
        fields: { body }
      })
    }
  })
  return async () => {
    await until(() => lines(file).length > before, 'the hook answer')
    return JSON.parse(lines(file)[before])
  }
}

/** The answer Claude Code would act on when the chat runs `command`. */
export async function askGuardChat(
  host: StructuredAgentSessionHost,
  session: string,
  command = 'git push --force origin main'
): Promise<unknown> {
  return (await sendGuardChat(host, session, command))()
}

/** The decision and reason in a hook answer. */
export function decisionOf(answer: unknown): { decision: unknown; reason: string } {
  const output =
    typeof answer === 'object' && answer !== null && 'hookSpecificOutput' in answer
      ? answer.hookSpecificOutput
      : null
  const fields: Record<string, unknown> =
    typeof output === 'object' && output !== null ? { ...output } : {}
  return {
    decision: fields.permissionDecision ?? null,
    reason: String(fields.permissionDecisionReason ?? '')
  }
}
