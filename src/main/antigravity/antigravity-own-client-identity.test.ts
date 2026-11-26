import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { ANTIGRAVITY_LAUNCH_SPEC } from './antigravity-acp-launch-spec'
import { antigravityHostAccountHome } from './antigravity-host-acp'
import { acpClientInfo } from '../acp/launch/acp-client-info'
import type { AcpLaunchSpec } from '../acp/launch/acp-launch-contract'
import { readSessionModels } from '../acp/discovery/acp-listing-session-models'
import type { AcpSessionModelDiscovery } from '../acp/discovery/acp-model-discovery-policy'
import { createAcpStructuredLaunchResolver } from '../runtime/agent-session/launch/structured-agent-launch-composition.test-support'
import { agentSessionRecordFixture } from '../native-chat/testing/agent-session-record-test-fixture'

const MANAGED = ANTIGRAVITY_LAUNCH_SPEC
const AGY = ANTIGRAVITY_LAUNCH_SPEC.hostBackend.spec
const AGY_ORCA_HOME = ANTIGRAVITY_LAUNCH_SPEC.hostBackend.otherSpecs[0]

const folders: string[] = []
afterEach(async () => {
  await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('Antigravity handshakes name Orca', () => {
  it.each([
    ['managed server', MANAGED as AcpLaunchSpec, '1.5.2'],
    ['managed server, version unknown', MANAGED as AcpLaunchSpec, null],
    ['agy 1.6.0', AGY, '1.6.0'],
    ['agy, version unknown', AGY, null],
    ['agy 1.5.0', AGY, '1.5.0'],
    ['agy on Orca home', AGY_ORCA_HOME, '1.5.5']
  ])('%s', (_name, spec, version) => {
    expect(acpClientInfo(spec, version).name).toBe('orca')
  })
})

function listingConnection(modelIds: string[]) {
  const availableModels = modelIds.map((modelId) => ({ modelId, name: modelId }))
  return {
    initialize: async () => ({
      protocolVersion: 1,
      agentCapabilities: { sessionCapabilities: { delete: {} } }
    }),
    start: async () => ({
      sessionId: 'listing-1',
      response: {
        sessionId: 'listing-1',
        models: { availableModels, currentModelId: modelIds[0] }
      }
    }),
    setConfigOption: async () => ({ configOptions: [] }),
    deleteSession: async () => ({}),
    close: async () => undefined
  }
}

describe("managed server's model picker", () => {
  const discovery = MANAGED.modelDiscovery as AcpSessionModelDiscovery

  it('says why a Google-account listing is Gemini only and names the update', async () => {
    const { models } = await readSessionModels(
      MANAGED,
      discovery,
      listingConnection(['gemini-3.1-pro', 'gemini-3.5-flash']) as never,
      '/listing'
    )
    expect(models[0].description).toContain('allowlisted editors')
    expect(models[0].description).toContain('agy 1.5.1 or newer')
    expect(models[1].description).toBeUndefined()
  })

  it('adds nothing when other models are listed', async () => {
    const { models } = await readSessionModels(
      MANAGED,
      discovery,
      listingConnection(['gemini-3.1-pro', 'claude-sonnet-4-6']) as never,
      '/listing'
    )
    expect(models.every((model) => model.description === undefined)).toBe(true)
  })
})

describe('agy below 1.5.1 refuses a non-Gemini model before the session opens', () => {
  it.each([
    ['1.5.0', 'claude-sonnet-4-6', true],
    ['1.4.9', 'gpt-oss-120b', true],
    [null, 'claude-sonnet-4-6', true],
    ['1.5.1', 'claude-sonnet-4-6', false],
    ['1.5.0', 'gemini-3.1-pro', false]
  ])('agy %s, %s', (version, model, refused) => {
    const refusal = AGY.refuseModel?.(model, version) ?? null
    expect(refusal !== null).toBe(refused)
    if (refused) {
      expect(refusal).toContain('Update agy to 1.5.1 or newer')
    }
  })

  async function launchAgyChat(model: string) {
    const home = await mkdtemp(join(tmpdir(), 'agy-model-gate-'))
    folders.push(home)
    const record = agentSessionRecordFixture({
      sessionId: 'chat-1',
      provider: 'antigravity',
      accountHome: antigravityHostAccountHome(home),
      options: { model }
    })
    const resolve = createAcpStructuredLaunchResolver(ANTIGRAVITY_LAUNCH_SPEC, {
      store: { getRecord: () => record, pinLaunchDirectory: async () => record },
      resolveWorkspacePath: async () => home,
      resolveEnvironment: async () => ({ PATH: '/usr/bin', HOME: home }),
      resolveCommand: () => '/opt/agy/bin/agy',
      homePath: home,
      inheritedEnv: {},
      // agy answered --version with nothing Orca could read.
      probeVersion: async () => ({ version: null }),
      savedSession: { hasProviderTurn: async () => false }
    })
    return resolve({
      identity: {
        sessionId: 'chat-1',
        workspaceId: 'workspace-1',
        hostId: 'local',
        agent: 'antigravity',
        providerHandle: null
      }
    })
  }

  it('refuses at launch, before any process starts', async () => {
    await expect(launchAgyChat('claude-sonnet-4-6')).rejects.toThrow('Update agy to 1.5.1 or newer')
  })

  it('launches a Gemini model on the same agy', async () => {
    const launched = await launchAgyChat('gemini-3.1-pro')
    expect(launched).toMatchObject({ command: '/opt/agy/bin/agy' })
  })
})

describe('no direct Google internal API calls', () => {
  // Google told other clients that calling its internal APIs can get an account flagged; usage
  // comes from agy's own /usage command.
  const INTERNAL = /cloudcode-pa|v1internal|daily-cloudcode|autopush-cloudcode|sandbox\.googleapis/
  const roots = ['src/main/antigravity', 'src/main/rate-limits/providers/antigravity']

  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) {
        return sources(path)
      }
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
    })
  }

  it.each(roots)('%s names no internal Google endpoint outside comments', (root) => {
    const offenders = sources(join(process.cwd(), root)).filter((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .some((line) => !/^\s*(\/\/|\*|\/\*)/.test(line) && INTERNAL.test(line))
    )
    expect(offenders).toEqual([])
  })
})
