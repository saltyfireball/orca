// FORK.md "agy skip-permissions guard" (BAD-877): the readiness check is the one agy launch that
// always passes `--dangerously-skip-permissions`, so it must never open a session or send a prompt:
// it only initializes and lists sessions, then agy exits. The one stand-in is the process: a
// scripted agy that answers like agy 1.5.16 and records what it was sent; the check itself, its
// disposable folder and its exit proof are the real code.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as ConnectionModule from '../../acp/process/acp-agent-connection'
import type { AcpScriptedAgent } from '../../acp/process/testing/acp-scripted-agent.test-support'
import type { ProviderProcessLaunch } from '../../provider-process/provider-process-launch'

const spawned = vi.hoisted(() => ({
  launches: [] as ProviderProcessLaunch[],
  agents: [] as AcpScriptedAgent[]
}))

vi.mock('../../acp/process/acp-agent-connection', async (importOriginal) => {
  const actual = await importOriginal<typeof ConnectionModule>()
  const { FakeAcpChild } =
    await import('../../acp/process/testing/acp-scripted-connection.test-fixture')
  const { AcpScriptedAgent } =
    await import('../../acp/process/testing/acp-scripted-agent.test-support')
  return {
    ...actual,
    createAcpAgentConnection: (
      launch: ProviderProcessLaunch,
      options: ConnectionModule.AcpAgentConnectionOptions
    ) => {
      const agent = new AcpScriptedAgent()
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
      agent.on('session/list', (frame) => agent.reply(frame, { sessions: [] }))
      // Answered too, so a check that opened a session would be seen doing it, not hang.
      agent.on('session/new', (frame) => agent.reply(frame, { sessionId: 'agy-probe-session' }))
      agent.on('session/prompt', (frame) => agent.reply(frame, { stopReason: 'end_turn' }))
      spawned.launches.push(launch)
      spawned.agents.push(agent)
      return new FakeAcpChild(launch, options, agent)
    }
  }
})

const {
  checkAntigravityHostAcp,
  checkAntigravityHostAcpCompatible,
  forgetAntigravityHostAcpChecks
} = await import('../../antigravity/antigravity-host-acp')

const folders: string[] = []
afterEach(async () => {
  forgetAntigravityHostAcpChecks()
  spawned.launches.splice(0)
  spawned.agents.splice(0)
  await Promise.all(folders.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

/** An agy program file: the check reads its identity, and the scripted agy answers for it. */
async function agyProgram(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agy-probe-guard-'))
  folders.push(dir)
  const agy = join(dir, 'agy')
  await writeFile(agy, '')
  return agy
}

function sentMethods(): string[] {
  return spawned.agents.flatMap((agent) =>
    agent.frames.flatMap((frame) => (frame.method === undefined ? [] : [frame.method]))
  )
}

describe('the agy readiness check opens no session', () => {
  it('launches with the flag, then only initializes and lists sessions', async () => {
    const agy = await agyProgram()
    await expect(checkAntigravityHostAcp(agy, {}, [])).resolves.toBe('ready')
    expect(spawned.launches).toEqual([
      expect.objectContaining({ command: agy, args: ['acp', '--dangerously-skip-permissions'] })
    ])
    expect(sentMethods()).toEqual(['initialize', 'session/list'])
  })

  it('the compatibility check only initializes', async () => {
    const agy = await agyProgram()
    await expect(checkAntigravityHostAcpCompatible(agy, {}, [], { start: true })).resolves.toBe(
      'ready'
    )
    expect(spawned.launches).toEqual([
      expect.objectContaining({ command: agy, args: ['acp', '--dangerously-skip-permissions'] })
    ])
    expect(sentMethods()).toEqual(['initialize'])
  })
})
