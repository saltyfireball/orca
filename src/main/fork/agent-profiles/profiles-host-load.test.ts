// BAD-800 proof, run by default: a host loads agent and MCP profiles before it takes a launch, and
// one that has not says so. Real launch scope, real headless install, and the real orcad activation
// (`activateBackendRuntime`): every main-process module it imports is a stand-in, found from its own
// imports so a new one is covered too, except the fork's headless install, which runs as it is.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  forkAgentProfileLaunchOfTask,
  uninstallForkAgentProfileLaunchForTests,
  withForkAgentProfileLaunchScope
} from './agent-profile-launch-scope'
import type * as AgentQueueRuntime from '../agent-queue/agent-queue-runtime'
import { forkAgentQueueRuntimeTerminals } from '../agent-queue/agent-queue-runtime'
import { installForkHeadlessHost } from '../headless-host'
import {
  forkMcpServiceState,
  uninstallForkMcpProfilesForTests
} from '../mcp-profiles/mcp-profiles-service'
import { forkMarkHeadlessSettingsHost } from '../settings-cli/settings-cli-headless'

vi.mock('../agent-queue/agent-queue-runtime', async (original) => {
  const actual = await original<typeof AgentQueueRuntime>()
  return {
    ...actual,
    forkAgentQueueRuntimeTerminals: vi.fn(actual.forkAgentQueueRuntimeTerminals)
  }
})

const settings = { forkAgentProfiles: [{ name: 'nightly', agent: 'claude' }] }
const NOT_LOADED = /Agent profiles are not loaded on this computer/
const ACTIVATION = resolve(__dirname, '../../backend/core-runtime-activation.ts')

let userData = ''
const cleanups: (() => unknown)[] = []

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'profiles-host-load-'))
})

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) {
    await cleanup()
  }
  forkMarkHeadlessSettingsHost(false)
  uninstallForkMcpProfilesForTests()
  uninstallForkAgentProfileLaunchForTests()
  rmSync(userData, { recursive: true, force: true })
})

/** What a `--profile nightly` agent launch does in the dispatcher's scope here. */
function launchWithProfile(): string {
  return withForkAgentProfileLaunchScope(
    {
      request: { method: 'agent.launch', params: { agent: 'claude', forkAgentProfile: 'nightly' } }
    },
    () => 'started'
  )
}

/** Answers every call, construction and property with another stand-in; awaits settle at once. */
function stand(overrides: Record<PropertyKey, unknown> = {}): unknown {
  const children = new Map<PropertyKey, unknown>()
  return new Proxy(function standIn() {}, {
    get(_target, key) {
      if (Object.hasOwn(overrides, key)) {
        return overrides[key]
      }
      if (key === 'then') {
        return undefined
      }
      if (key === Symbol.toPrimitive || key === 'toString') {
        return () => 'stand-in'
      }
      if (key === Symbol.iterator) {
        return function* empty() {}
      }
      if (!children.has(key)) {
        children.set(key, stand())
      }
      return children.get(key)
    },
    apply: () => stand(),
    construct: () => stand() as object
  })
}

function module(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const exports = new Map<PropertyKey, unknown>()
  return new Proxy<Record<string, unknown>>(
    {},
    {
      get(_target, key) {
        if (key === 'then') {
          return undefined
        }
        if (!exports.has(key)) {
          exports.set(
            key,
            typeof key === 'string' && Object.hasOwn(overrides, key) ? overrides[key] : stand()
          )
        }
        return exports.get(key)
      },
      has: () => true
    }
  )
}

describe('profiles on a host', () => {
  it('a host that has not loaded agent profiles refuses a --profile launch as that', () => {
    expect(launchWithProfile).toThrow(NOT_LOADED)
    // A retry or follow-up of a Task first started with one.
    expect(() =>
      forkAgentProfileLaunchOfTask(
        { profile: 'nightly', preamble: '', agent: 'claude' },
        undefined,
        false
      )
    ).toThrow(NOT_LOADED)
  })

  it('the headless install loads agent and MCP profiles', async () => {
    const store = { getSettings: () => settings, onSettingsChanged: () => undefined }
    cleanups.push(await installForkHeadlessHost(store, userData))
    expect(launchWithProfile()).toBe('started')
    expect(forkMcpServiceState()?.launchFolder).toBe(join(userData, 'fork-mcp-profiles', 'launch'))
  })

  it('orcad activation loads them before its RPC server starts', async () => {
    const seenAtRpcStart: { launch?: string; mcpLoaded?: boolean } = {}
    const STOP = new Error('stopped at rpc start')
    const imports = [
      ...readFileSync(ACTIVATION, 'utf8').matchAll(/(?:from|import\()\s*'(\.[^']+)'/g)
    ].map((match) => match[1])
    const overrides: Record<string, Record<string, unknown>> = {
      '../../shared/app-lifecycle/app-environment': {
        getAppEnvironment: () => stand({ getPath: () => userData })
      },
      '../orcad/diagnostics/orcad-startup-timing': {
        createOrcadStartupTiming: () => ({
          time: (_name: string, run: () => unknown) => run(),
          report: () => undefined
        })
      },
      '../orcad/profile-state/orcad-profile-state-startup': {
        createOrcadProfileStateStartup: () => ({
          store: stand({ getSettings: () => settings, onSettingsChanged: () => undefined }),
          authority: stand()
        })
      },
      '../orcad/host-runtime/orcad-runtime-rpc': {
        createOrcadRuntimeRpcServer: () =>
          stand({
            start: () => {
              try {
                seenAtRpcStart.launch = launchWithProfile()
              } catch (error) {
                seenAtRpcStart.launch = (error as Error).message
              }
              seenAtRpcStart.mcpLoaded = forkMcpServiceState() !== null
              throw STOP
            }
          })
      }
    }
    for (const specifier of imports) {
      // Shared modules are plain values and helpers; only the app environment says where data goes.
      if (
        specifier === '../fork/headless-host' ||
        (specifier.startsWith('../../shared/') && !overrides[specifier])
      ) {
        continue
      }
      const path = resolve(dirname(ACTIVATION), specifier)
      vi.doMock(path, () => module(overrides[specifier]))
    }
    const { activateBackendRuntime } = await import(ACTIVATION)
    const host = stand({ options: {}, prepareCliLauncher: async () => undefined })
    await expect(
      activateBackendRuntime(
        host,
        (cleanup: () => unknown) => cleanups.push(cleanup),
        stand(),
        () => undefined
      )
    ).rejects.toBe(STOP)
    for (const specifier of imports) {
      vi.doUnmock(resolve(dirname(ACTIVATION), specifier))
    }
    expect(seenAtRpcStart).toEqual({ launch: 'started', mcpLoaded: true })
    // BAD-818: the launch queue reads this host's runtime.
    const readRuntime = vi.mocked(forkAgentQueueRuntimeTerminals).mock.lastCall?.[0]
    expect(readRuntime?.()).toBeDefined()
  })
})
