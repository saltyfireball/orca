// FORK.md "agy skip-permissions guard" (BAD-877): an Antigravity chat on the host's agy gains
// `--dangerously-skip-permissions` only in Full access, and Orca hands every permission request agy
// sends to the person, in every mode. Upstream added the flag (#39471) and later deleted the tests
// that held both; these go through the real launch resolver, acquire and permission handler.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { AgentChatPermissionChoice } from '../../../shared/agent-launch/permissions/agent-chat-permission-mode'
import { ANTIGRAVITY_LAUNCH_SPEC } from '../../antigravity/antigravity-acp-launch-spec'
import { antigravityHostAccountHome } from '../../antigravity/antigravity-host-acp'
import { FakeAcpChild } from '../../acp/process/testing/acp-scripted-connection.test-fixture'
import { tick } from '../../acp/process/testing/acp-scripted-agent.test-support'
import { acquireAcpStructuredSession } from '../../acp/session/acp-structured-acquire'
import { acpStructuredAgentDefinition } from '../../acp/session/acp-structured-agent-definitions'
import { AcpStructuredSessionAdapter } from '../../acp/session/acp-structured-session-adapter'
import type { AcpStructuredSessionAdapterDeps } from '../../acp/session/acp-structured-session-adapter-deps'
import { AcpStructuredChildren } from '../../acp/session/children/acp-structured-child-lifecycle'
import { structuredAgentSessionLaunchPermission } from '../../native-chat/agent-session-wire/options/structured-agent-session-launch-permission'
import { StructuredAgentRegistry } from '../../native-chat/agent-session-wire/providers/structured-agent-registry'
import { agentSessionRecordFixture } from '../../native-chat/testing/agent-session-record-test-fixture'
import { createAcpStructuredLaunchResolver } from '../../runtime/agent-session/launch/structured-agent-launch-composition.test-support'

const SKIP_FLAG = '--dangerously-skip-permissions'
const IDENTITY = {
  sessionId: 'chat-1',
  workspaceId: 'workspace-1',
  hostId: 'local',
  agent: 'antigravity',
  providerHandle: null
}
const ConfigOption = z.object({ configId: z.string(), value: z.string() })
const folders: string[] = []
afterEach(async () => {
  await Promise.all(folders.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

/** Starts an agy chat whose record saved `saved` (absent: none), as the host does: the launch mode
 *  is read from the record, the real resolver builds agy's argv, and acquire opens it. */
async function startAgyChat(saved: AgentChatPermissionChoice | undefined) {
  const home = await mkdtemp(join(tmpdir(), 'agy-permission-guard-'))
  folders.push(home)
  const record = agentSessionRecordFixture({
    sessionId: IDENTITY.sessionId,
    provider: 'antigravity',
    accountHome: antigravityHostAccountHome(home),
    options: { model: 'gemini-3.1-pro' },
    ...(saved ? { permissionMode: saved } : {})
  })
  const resolve = createAcpStructuredLaunchResolver(ANTIGRAVITY_LAUNCH_SPEC, {
    store: { getRecord: () => record, pinLaunchDirectory: async () => record },
    resolveWorkspacePath: async () => home,
    resolveEnvironment: async () => ({ PATH: '/usr/bin', HOME: home }),
    resolveCommand: () => '/opt/agy/bin/agy',
    homePath: home,
    inheritedEnv: {},
    probeVersion: async () => ({ version: '1.5.16' }),
    savedSession: { hasProviderTurn: async () => false }
  })
  let child: FakeAcpChild | undefined
  const deps: AcpStructuredSessionAdapterDeps = {
    spec: ANTIGRAVITY_LAUNCH_SPEC,
    resolveLaunch: resolve,
    readLaunch: (identity) => resolve({ identity, spawnToken: null }),
    dataDirectory: home,
    connect: (spawn, options) => (child = new FakeAcpChild(spawn, options)),
    readProcessStartTime: async () => 1
  }
  const agents = new StructuredAgentRegistry([
    {
      definition: acpStructuredAgentDefinition(ANTIGRAVITY_LAUNCH_SPEC),
      adapter: new AcpStructuredSessionAdapter(deps)
    }
  ])
  const permissionMode = await structuredAgentSessionLaunchPermission({ agents }, record)
  const children = new AcpStructuredChildren(deps)
  const steps: unknown[] = []
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a scripted acquire reads only these fields
  const { session } = await acquireAcpStructuredSession({
    acquire: {
      identity: IDENTITY,
      fence: 1,
      spawnToken: 'spawn-1',
      ...(permissionMode ? { permissionMode } : {}),
      events: {
        tryAppendTransition: (transition: { steps: unknown[] }) => {
          steps.push(...transition.steps)
          return { accepted: true }
        }
      }
    },
    deps,
    generation: 'g1',
    abandoned: () => false,
    track: () => {},
    onExit: () => {},
    onConnectionLost: () => {},
    onSettled: () => {},
    forceClose: (id: string, reason: string) => children.stopAfterFailure(id, reason),
    interrupt: (id: string, reason: string) => children.interrupt(id, reason)
  } as never)
  children.sessions.set(IDENTITY.sessionId, session)
  const agent = child!.agent
  const modes: string[] = []
  agent.on('initialize', (frame) =>
    agent.reply(frame, {
      protocolVersion: 1,
      agentInfo: { name: 'Antigravity ACP Server', version: '1.5.16' },
      agentCapabilities: {
        loadSession: true,
        sessionCapabilities: { resume: {}, list: {} },
        _meta: { antigravity: { systemPrompt: { append: true } } }
      }
    })
  )
  agent.on('session/new', (frame) => agent.reply(frame, { sessionId: 'agy-1' }))
  agent.on('session/set_config_option', (frame) => {
    const { configId, value } = ConfigOption.parse(frame.params)
    modes.push(value)
    agent.reply(frame, {
      configOptions: [
        {
          id: configId,
          name: 'Mode',
          type: 'select',
          category: 'mode',
          currentValue: value,
          options: []
        }
      ]
    })
  })
  await session.open(new AbortController().signal)
  return { permissionMode, args: child!.launch.args, agent, modes, steps }
}

const SAVED_MODES = [
  // saved mode, the mode the launch runs, agy's session mode Orca sets, whether the flag is passed
  [undefined, 'ask', ['default'], false],
  ['ask', 'ask', ['default'], false],
  ['accept-edits', 'accept-edits', ['accept-edits'], false],
  ['own', 'own', [], false],
  // agy chats offer no Auto: a saved one asks, never anything wider.
  ['auto', 'ask', ['default'], false],
  // agy has no Full access session mode: its default mode plus the launch flag.
  ['full-access', 'full-access', ['default'], true]
] as const

describe('agy chat argv follows the saved permission mode', () => {
  it.each(SAVED_MODES)('saved %s launches %s', async (saved, mode, agyModes, flagged) => {
    const chat = await startAgyChat(saved)
    expect(chat.permissionMode).toBe(mode)
    expect(chat.args).toEqual(flagged ? ['acp', SKIP_FLAG] : ['acp'])
    expect(chat.modes).toEqual(agyModes)
  })
})

describe('Orca hands every agy permission request to the person', () => {
  it.each(SAVED_MODES)('saved %s', async (saved) => {
    const chat = await startAgyChat(saved)
    let answered: unknown = null
    void chat.agent
      .request(7, 'session/request_permission', {
        sessionId: 'agy-1',
        toolCall: { toolCallId: 'call-1', title: 'Run rm -rf build' },
        options: [
          { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
          { optionId: 'deny', name: 'Deny', kind: 'reject_once' }
        ]
      })
      .then((reply) => {
        answered = reply
      })
    for (let i = 0; i < 10; i++) {
      await tick()
    }
    // No answer from Orca: the request waits as an open approval in the chat, for the person.
    expect(answered).toBeNull()
    expect(chat.steps).toContainEqual(
      expect.objectContaining({
        resolution: expect.objectContaining({
          kind: 'request-open',
          request: expect.objectContaining({ key: 'session/request_permission:7' }),
          body: expect.objectContaining({
            kind: 'approval',
            title: 'Run rm -rf build',
            resolution: expect.objectContaining({ state: 'pending', resolvedBy: null })
          })
        })
      })
    )
  })
})
