// BAD-873 tests: a real runtime, chat host and ACP client around the made-up custom agent
// `pebble` (pebble-acp-agent.test-fixture.mjs). The test file mocks electron and telemetry.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { installFakeAppEnvironment } from '../../../../config/scripts/test-runtime/environment/vitest-host-ports-setup'
import { computeAgentSessionPayloadFingerprint } from '../../../shared/agent-session/lifecycle/operations/agent-session-mutation-envelope'
import { hostTestMessage } from '../../native-chat/agent-session-wire/host/testing/structured-agent-session-host-test-data.test-fixture'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import type { StructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-host'
import { initOrcaProfilePaths } from '../../orca-profiles/profile-storage-paths'
import { createStore, testState } from '../../persistence/persistence-test-harness'
import { openTestAgentSessionRecordStoreSlot } from '../../runtime/agent-session/records/agent-session-record-store-test-harness'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { mintAgentSessionOperationId } from '../../runtime/orchestration/mailbox/structured-pointer/structured-pointer-operation-id'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { FORK_CUSTOM_ACP_AGENT_METHODS } from '../../runtime/rpc/methods/fork/fork-custom-acp-agents'
import { readChatJournalTail } from '../chat-journal-tail'
import { installForkCustomAcpAgentsOnHost } from './custom-acp-agents-host'

export const PEBBLE = join(import.meta.dirname, 'pebble-acp-agent.test-fixture.mjs')
export const PEBBLE_TOKEN = 'made-up-pebble-token-5c2e'
/** The caller startChat creates its chats under. */
export const CUSTOM_ACP_CALLER = { callerKey: 'trusted-local:fork-custom-acp-agents' }

/** Orca runs every agent under its own supervisor; built from its source, as a dev build does.
 *  Returns the app folder to point the fake app at. */
export function buildProviderSupervisor(): string {
  const appRoot = mkdtempSync(join(tmpdir(), 'custom-acp-app-'))
  const folder = join(appRoot, 'native/provider-exec/.build', `${process.platform}-${process.arch}`)
  mkdirSync(folder, { recursive: true })
  execFileSync(process.platform === 'darwin' ? 'clang' : 'cc', [
    '-std=c11',
    '-O2',
    resolve(import.meta.dirname, '../../../../native/provider-exec/provider-exec.c'),
    '-o',
    join(folder, 'orca-provider-exec')
  ])
  return appRoot
}

/** What the agent was sent, as far as these tests read it. */
export type ReportParams = {
  [key: string]: unknown
  cwd?: string
  sessionId?: string
  _meta?: { orca?: { context?: string; systemPrompt?: string } }
}

export type ReportEntry = {
  [key: string]: unknown
  kind: string
  method?: string
  params?: ReportParams
}

export function reportEntries(report: string): ReportEntry[] {
  return existsSync(report)
    ? readFileSync(report, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the lines are the made-up agent's own report entries.
        .map((line) => JSON.parse(line) as ReportEntry)
    : []
}

export async function until<T>(read: () => Promise<T | null> | T | null, what: string): Promise<T> {
  const deadline = Date.now() + 30_000
  for (;;) {
    const value = await read()
    if (value !== null) {
      return value
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out: ${what}`)
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
  }
}

/** One fork.customAcpAgents.* handler, its params parsed as the RPC layer does. */
export async function callCustomAcp<T = unknown>(
  runtime: OrcaRuntimeService,
  name: string,
  raw: unknown
): Promise<T> {
  const found = FORK_CUSTOM_ACP_AGENT_METHODS.find((entry) => entry.name === name)
  if (!found) {
    throw new Error(name)
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: these handlers read only the runtime.
  const handler = found.handler as (params: unknown, ctx: never) => Promise<unknown>
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: each test names the result of the method it calls.
  return (await handler(found.params.parse(raw), { runtime } as never)) as T
}

/** Opens the journal's slot as tests run its SQL worker; the runtime's install then finds it. */
export async function openJournalSlot(): Promise<void> {
  await openTestAgentSessionRecordStoreSlot({
    stateDirectory: testState.dir,
    hostId: 'local',
    logger: { warn: () => {}, error: () => {} },
    legacySessionTabIds: []
  })
}

/** A runtime over a test store with one folder project at `work`, custom agents installed. */
export async function customAcpRuntime(appRoot: string, work: string) {
  const store = createStore()
  installFakeAppEnvironment({ getPath: () => testState.dir, getAppPath: () => appRoot })
  initOrcaProfilePaths()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a folder project; the store fills the rest.
  store.addRepo({
    id: 'r1',
    path: work,
    displayName: 'demo',
    badgeColor: '#fff',
    addedAt: 1,
    kind: 'folder'
  } as never)
  await openJournalSlot()
  const { OrcaRuntimeService } = await import('../../runtime/orca-runtime')
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the test store is the persistence store the app uses.
  const runtime = new OrcaRuntimeService(store as never)
  runtime.setOrchestrationDb(new OrchestrationDb(':memory:'))
  await installForkCustomAcpAgentsOnHost({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the host reads only forkCustomAcpAgents of the settings.
    readSettings: () => store.getSettings() as never,
    userDataPath: testState.dir
  })
  return { runtime, store }
}

/** Saves `pebble` through the real add handler, its report and token as env values. */
export async function savePebble(
  runtime: OrcaRuntimeService,
  report: string,
  saved: { env?: Record<string, string>; [field: string]: unknown } = {}
): Promise<void> {
  const { env, ...rest } = saved
  await callCustomAcp(runtime, 'fork.customAcpAgents.add', {
    name: 'pebble',
    command: process.execPath,
    args: [PEBBLE],
    env: { PEBBLE_REPORT: report, PEBBLE_TOKEN, ...env },
    ...rest
  })
}

export function requireHost(): StructuredAgentSessionHost {
  const host = getStructuredAgentSessionHost()
  if (!host) {
    throw new Error('no chat host')
  }
  return host
}

/** The chat's rows as JSON, enough to look for a reply or a failure line in. */
export async function chatRows(sessionId: string): Promise<string> {
  const host = getStructuredAgentSessionHost()
  return host ? JSON.stringify((await readChatJournalTail(host, sessionId)).items) : ''
}

export function waitForRow(sessionId: string, text: string): Promise<true> {
  return until(async () => ((await chatRows(sessionId)).includes(text) ? true : null), text)
}

/** Sends `text` to the chat as its owner would. */
export async function sendChat(sessionId: string, text: string): Promise<void> {
  const host = requireHost()
  const body = hostTestMessage(text)
  const sent = await host.send(CUSTOM_ACP_CALLER, {
    body,
    envelope: {
      sessionId,
      clientOperationId: mintAgentSessionOperationId(Date.now()),
      expectedRuntimeFence: host.deps.store.getRecord(sessionId)?.lease.runtimeFence ?? null,
      payloadFingerprint: computeAgentSessionPayloadFingerprint({
        method: 'agentSession.send',
        sessionId,
        fields: { body }
      })
    }
  })
  if (!sent.ok) {
    throw new Error(`send: ${JSON.stringify(sent.refusal)}`)
  }
}
