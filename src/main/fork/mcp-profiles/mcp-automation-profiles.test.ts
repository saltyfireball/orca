// BAD-800 proof: `orca automations create --profile nightly` keeps the profile's MCP profile on the
// automation record, and Run now launches Claude with only that profile's servers, on the terminal
// surface and on the chat surface. The CLI's flag handling and create handler, the real RPC
// dispatcher with the real automation methods, the real store and the real automation service
// all run; the stand-ins are the git worktree, the PTY and the chat host below the launchers, which
// hand the launch to the real terminal plan and the real chat creation hook.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeTestStores, createStore, testState } from '../../persistence/persistence-test-harness'
import type { HandlerContext } from '../../../cli/dispatch/dispatch'
import { applyForkAgentProfile } from '../../../cli/fork/agent-profile-flag'
import { AUTOMATION_HANDLERS } from '../../../cli/automations/automations'
import { formatAutomationShow } from '../../../cli/automations/automation-format'
import type { Automation } from '../../../shared/automations/automation-definition'
import { AUTOMATION_RUNTIME_CAPABILITIES } from '../../../shared/automations/automation-runtime-capabilities'
import { RpcDispatcher } from '../../runtime/rpc/dispatcher'
import { AUTOMATION_METHODS } from '../../runtime/rpc/methods/automations/automations'
import { FORK_AGENT_PROFILE_METHODS } from '../../runtime/rpc/methods/fork/fork-agent-profiles'
import { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { createRuntimeAutomationService } from '../../automations/runtime-automation-service'
import type { AutomationService } from '../../automations/automation-service'
import { installForkAgentProfileLaunch } from '../agent-profiles/agent-profile-launch-scope'
import { forkMcpClaudeLaunchArgs } from './mcp-claude-launch'
import { installForkMcpProfiles, uninstallForkMcpProfilesForTests } from './mcp-profiles-service'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir, isPackaged: false },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../../telemetry/client', () => ({ track: vi.fn() }))

// The chat host below the chat launcher: the launch goes into the real chat creation hook (which
// notes the MCP scope it ran in) with a stand-in for the provider session.
const chats = vi.hoisted(() => {
  const created: string[] = []
  return { created }
})
vi.mock('../../native-chat/agent-session-wire/acquisition/structured-agent-session-create', () => ({
  createStructuredAgentSession: () => Promise.resolve({ ok: true })
}))
vi.mock('../../runtime/rpc/methods/agent-launch/agent-launch', async (importOriginal) => {
  const real = await importOriginal<object>()
  const { structuredAgentSessionEntryDelegates } =
    await import('../../native-chat/agent-session-wire/acquisition/structured-agent-session-entry-delegates')
  return {
    ...real,
    launchAgentOnHost: async (params: { agent: string; operationId: string }) => {
      const sessionId = `chat-${params.operationId}`
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stubbed session create reads no context, and the fork hooks read only the envelope, agent, provider and location.
      const delegates = structuredAgentSessionEntryDelegates as unknown as (
        context: () => object
      ) => {
        create: (caller: unknown, params: unknown, options: unknown) => Promise<unknown>
      }
      await delegates(() => ({})).create(
        { kind: 'runtime' },
        { envelope: { sessionId }, agent: params.agent, provider: params.agent, location: {} },
        undefined
      )
      chats.created.push(sessionId)
      return {
        prompt: { outcome: 'journaled' },
        surface: { kind: 'chat', sessionId, worktreeId: 'wt-run' },
        worktreeId: 'wt-run'
      }
    }
  }
})

// The renderer's RPC transport: a call to this desktop goes to the test host's real dispatcher;
// a paired host answers with the capabilities of an Orca from before this change.
const transport = vi.hoisted(() => {
  const state: {
    dispatch: null | ((method: string, params: unknown) => Promise<unknown>)
    olderHostCapabilities: string[]
  } = { dispatch: null, olderHostCapabilities: [] }
  return state
})
vi.mock('../../../renderer/src/runtime/rpc/calls/runtime-rpc-call', () => ({
  callRuntimeRpc: (_target: unknown, method: string, params: unknown) =>
    transport.dispatch!(method, params)
}))
vi.mock('../../../renderer/src/runtime/rpc/compatibility/runtime-compatibility-probe', () => ({
  getRuntimeEnvironmentStatus: async () => ({ capabilities: transport.olderHostCapabilities })
}))

const forkSettings: { forkAgentProfiles: unknown[]; forkMcpProfiles: unknown[] } = {
  forkAgentProfiles: [{ name: 'nightly', agent: 'claude', mcpProfile: 'review-tools' }],
  forkMcpProfiles: [{ name: 'review-tools', mode: 'allow', servers: ['lint'] }]
}

let repoDir: string
let savedConfigDir: string | undefined
let service: AutomationService | null = null

beforeEach(async () => {
  forkSettings.forkMcpProfiles = [{ name: 'review-tools', mode: 'allow', servers: ['lint'] }]
  chats.created.length = 0
  testState.dir = mkdtempSync(join(tmpdir(), 'fork-automation-mcp-'))
  repoDir = join(testState.dir, 'repo')
  mkdirSync(repoDir)
  savedConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = join(testState.dir, 'claude')
  mkdirSync(process.env.CLAUDE_CONFIG_DIR)
  writeFileSync(
    join(process.env.CLAUDE_CONFIG_DIR, '.claude.json'),
    JSON.stringify({ mcpServers: { lint: { command: 'lint-mcp' }, docs: { command: 'docs-mcp' } } })
  )
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
})

afterEach(async () => {
  service?.stop()
  service = null
  uninstallForkMcpProfilesForTests()
  await closeTestStores()
  if (savedConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = savedConfigDir
  }
  rmSync(testState.dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

/** A host: the real store with the fork settings, its runtime, and the real RPC dispatcher. */
async function host() {
  const store = createStore()
  const stockSettings = store.getSettings.bind(store)
  vi.spyOn(store, 'getSettings').mockImplementation(() => ({
    ...stockSettings(),
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fork settings readers parse these lists themselves.
    ...(forkSettings as object)
  }))
  store.addRepo({
    id: 'repo-1',
    path: repoDir,
    displayName: 'demo',
    badgeColor: '#fff',
    addedAt: 1
  })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the host's settings hold every field these readers take.
  const readSettings = () => store.getSettings() as never
  await installForkMcpProfiles({
    readSettings,
    dataFolder: join(testState.dir, 'mcp'),
    chatStateFile: null
  })
  installForkAgentProfileLaunch({ readSettings, claudeRouter: () => undefined })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the real Store is what the runtime is built on.
  const runtime = new OrcaRuntimeService(store as never)
  const dispatcher = new RpcDispatcher({
    runtime,
    methods: [...AUTOMATION_METHODS, ...FORK_AGENT_PROFILE_METHODS]
  })
  const client = {
    call: async (method: string, params?: unknown) => {
      if (method === 'status.get') {
        // The CLI's capability probe; this host is the build under test.
        return { id: 'r', ok: true, result: { capabilities: [...AUTOMATION_RUNTIME_CAPABILITIES] } }
      }
      if (method === 'repo.show') {
        return { id: 'r', ok: true, result: { repo: { id: 'repo-1', path: repoDir } } }
      }
      const reply = await dispatcher.dispatch({ id: 'req', authToken: 'tok', method, params })
      if (!reply.ok) {
        throw new Error(reply.error.message)
      }
      return { result: reply.result }
    }
  }
  transport.dispatch = async (method, params) => (await client.call(method, params)).result
  return { store, runtime, dispatcher, client }
}

type Host = Awaited<ReturnType<typeof host>>

async function createWithProfile(target: Host, surface: 'chat' | 'terminal'): Promise<Automation> {
  const flags = new Map<string, string | boolean>([
    ['profile', 'nightly'],
    ['name', `Nightly lint ${surface}`],
    ['prompt', 'Lint the repo.'],
    ['trigger', 'daily'],
    ['repo', 'id:repo-1'],
    ['workspace-mode', 'new_per_run']
  ])
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler context fields the profile flag and create handler read.
  const ctx = {
    flags,
    client: target.client,
    cwd: repoDir,
    json: true
  } as unknown as HandlerContext
  await applyForkAgentProfile('automations create', ctx)
  await AUTOMATION_HANDLERS['automations create']!(ctx)
  const created = target.store.listAutomations().find((a) => a.name === `Nightly lint ${surface}`)
  expect(created).toBeDefined()
  if (surface === 'terminal') {
    return created!
  }
  // The automation dialog's edit to a chat run; the record keeps its MCP profile.
  await target.client.call('automation.update', {
    id: created!.id,
    updates: { launchSetupPatch: { surface: 'chat' } }
  })
  return target.store.listAutomations().find((a) => a.id === created!.id)!
}

/** The terminal a terminal run starts: the git worktree is a stand-in, the plan is the runtime's. */
function captureTerminalArgv(target: Host): Promise<string> {
  return new Promise((resolve, reject) => {
    const standIn = async (args: { startupAgent?: 'claude' }): Promise<never> => {
      try {
        const plan = await target.runtime.resolveAgentTerminalCreateOptions(
          {
            id: 'repo-1::wt-run',
            path: repoDir,
            connectionId: null,
            repo: null,
            folderWorkspace: null
          },
          {
            startupAgent: args.startupAgent,
            launchRuntime: {
              platform: 'darwin',
              pty: { shellOverride: undefined, terminalWindowsWslDistro: null }
            }
          }
        )
        resolve(plan.command ?? '')
      } catch (error) {
        reject(error)
      }
      throw new Error('stand-in: no worktree')
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stand-in reads only startupAgent and never returns.
    vi.spyOn(target.runtime, 'createManagedWorktree').mockImplementation(standIn as never)
  })
}

function startService(target: Host): AutomationService {
  // A desktop with a window open; a headless test runtime reports none.
  vi.spyOn(target.runtime, 'canOpenRunTerminals').mockReturnValue(true)
  service = createRuntimeAutomationService({
    store: target.store,
    runtime: target.runtime,
    allowRemoteHostScheduling: false
  })
  return service
}

function keptServers(file: string | undefined): unknown {
  expect(file).toBeDefined()
  return JSON.parse(readFileSync(file!, 'utf8'))
}

describe('automations create --profile with an MCP profile (BAD-800)', () => {
  it('keeps it on the automation record across a restart, shown by automations show', async () => {
    const target = await host()
    const automation = await createWithProfile(target, 'terminal')
    expect(automation.forkMcpProfile).toBe('review-tools')
    await target.store.flushPendingOrThrowAsync?.({ drainToStableGeneration: true })
    await closeTestStores()
    const [reloaded] = createStore().listAutomations()
    expect(reloaded).toMatchObject({ id: automation.id, forkMcpProfile: 'review-tools' })
    expect(formatAutomationShow({ automation: reloaded! })).toContain('mcp profile: review-tools')
  })

  it('a terminal Run now launches Claude with only its servers', async () => {
    const target = await host()
    const automation = await createWithProfile(target, 'terminal')
    const argv = captureTerminalArgv(target)
    await startService(target).runNow(automation.id)
    const command = await argv
    const file = /'--strict-mcp-config' '--mcp-config' '([^']+)'/.exec(command)?.[1]
    expect(keptServers(file)).toEqual({ mcpServers: { lint: { command: 'lint-mcp' } } })
  })

  it('a chat Run now creates a chat whose Claude loads only its servers', async () => {
    const target = await host()
    const automation = await createWithProfile(target, 'chat')
    await startService(target).runNow(automation.id)
    expect(automation).toMatchObject({ surface: 'chat', forkMcpProfile: 'review-tools' })
    await vi.waitFor(() => expect(chats.created).toHaveLength(1))
    const args = await forkMcpClaudeLaunchArgs({
      sessionId: chats.created[0]!,
      cwd: repoDir,
      configDir: process.env.CLAUDE_CONFIG_DIR!,
      env: { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR },
      wsl: false,
      userArgs: {},
      policyFiles: []
    })
    expect(args['strict-mcp-config']).toBeNull()
    expect(keptServers(args['mcp-config'] ?? undefined)).toEqual({
      mcpServers: { lint: { command: 'lint-mcp' } }
    })
  })

  it('refuses a run once the MCP profile is deleted, without launching', async () => {
    const target = await host()
    const automation = await createWithProfile(target, 'terminal')
    forkSettings.forkMcpProfiles = []
    const launched = vi.spyOn(target.runtime, 'createManagedWorktree')
    const run = await startService(target).runNow(automation.id)
    await vi.waitFor(() =>
      expect(
        target.store.listAutomationRuns(automation.id).find((r) => r.id === run.id)
      ).toMatchObject({
        status: 'dispatch_failed',
        error: expect.stringMatching(/did not run: Unknown MCP profile "review-tools"/)
      })
    )
    expect(launched).not.toHaveBeenCalled()
  })

  it('creates nothing on a host whose MCP profiles are not loaded', async () => {
    const target = await host()
    uninstallForkMcpProfilesForTests()
    await expect(createWithProfile(target, 'terminal')).rejects.toThrow(
      /MCP profiles are not loaded/
    )
    expect(target.store.listAutomations()).toHaveLength(0)
  })
})

// The renderer's own move, loaded by path: the node typecheck does not resolve renderer aliases.
const SAVE_OPERATIONS = new URL(
  '../../../renderer/src/components/automations/authoring/automation-orca-save-operations.ts',
  import.meta.url
).pathname
type MoveResult = { saved: { ok: boolean }; originalRemoved: boolean }

/** The automation dialog's move of `source` (its own form input) to `authority`. */
async function move(
  source: Automation,
  authority:
    | { kind: 'desktop' }
    | { kind: 'runtime'; environmentId: string; pairingRevision: number }
) {
  // The dialog's form holds the editable fields only: no record identity and no MCP profile.
  const {
    id: _id,
    createdAt: _c,
    updatedAt: _u,
    nextRunAt: _n,
    launchSetup: _l,
    forkMcpProfile: _m,
    creationKey: _k,
    ...input
  } = source
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the module's export, typed loosely because it is loaded by path.
  const { moveAutomationToDestination } = (await import(/* @vite-ignore */ SAVE_OPERATIONS)) as {
    moveAutomationToDestination: (...args: unknown[]) => Promise<MoveResult>
  }
  return moveAutomationToDestination(
    {
      automationDispatchContext: { capturedOwners: new Map(), authority: { kind: 'desktop' } },
      editingRowKey: null,
      automationDialogTarget: { kind: 'local' },
      moveCreationKeysRef: { current: new Map() },
      invalidateWrittenHost: () => undefined
    },
    source,
    {
      authority,
      destination: { selector: { kind: 'self' } },
      entry: { stableKey: `${authority.kind}-target`, authorityLabel: 'Other host', stableRef: {} }
    },
    { ...input, workspaceId: null }
  )
}

describe('moving an automation to another host in the automation dialog (BAD-800)', () => {
  it('the copy keeps the MCP profile, so its runs stay limited', async () => {
    const target = await host()
    const source = await createWithProfile(target, 'terminal')
    const moved = await move(source, { kind: 'desktop' })
    expect(moved).toMatchObject({ saved: { ok: true }, originalRemoved: true })
    const [copy, ...rest] = target.store.listAutomations()
    expect(rest).toHaveLength(0)
    expect(copy).toMatchObject({ name: source.name, forkMcpProfile: 'review-tools' })
    expect(copy!.id).not.toBe(source.id)
  })

  it('a host without the MCP profile refuses the move, and the original stays', async () => {
    const target = await host()
    const source = await createWithProfile(target, 'terminal')
    forkSettings.forkMcpProfiles = []
    const moved = await move(source, { kind: 'desktop' })
    expect(moved).toMatchObject({
      saved: {
        ok: false,
        notice: { message: expect.stringMatching(/Unknown MCP profile "review-tools"/) }
      },
      originalRemoved: false
    })
    expect(target.store.listAutomations().map((a) => a.id)).toEqual([source.id])
  })

  it('a host whose Orca cannot keep it refuses the move, and the original stays', async () => {
    const target = await host()
    const source = await createWithProfile(target, 'terminal')
    transport.olderHostCapabilities = AUTOMATION_RUNTIME_CAPABILITIES.filter(
      (capability) => !capability.startsWith('automations.fork-mcp-profile')
    )
    const moved = await move(source, {
      kind: 'runtime',
      environmentId: 'env-1',
      pairingRevision: 1
    })
    expect(moved).toMatchObject({
      saved: {
        ok: false,
        notice: { message: expect.stringMatching(/cannot keep it.*Nothing was moved/) }
      },
      originalRemoved: false
    })
    expect(target.store.listAutomations().map((a) => a.id)).toEqual([source.id])
  })
})
