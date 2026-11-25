// BAD-800 proof: a launch that arrives over the network runs in its launch scope. The paired
// WebSocket (a CLI's --environment, a server start, the desktop driving a server, the phone) and
// the renderer's ipc subscribe reach the dispatcher's streaming entry, which ran unary methods
// with no launch scope: `automations create --profile` over it stored no MCP profile and its runs
// loaded every server. Through the real CLI client, the real E2EE WebSocket pairing, the real RPC
// server and dispatcher, the real automation methods and store, and the real terminal plan. The
// agent.launch, worktree.create and orchestration.workerStart handlers are stand-ins (named so)
// that build the real terminal plan inside whatever scope they run in.
import '../../../shared/remote-runtime/host-store/environment-store-worker-test-fixture'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeTestStores, createStore, testState } from '../../persistence/persistence-test-harness'

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, args: unknown) => unknown>()
}))
vi.mock('electron', () => ({
  app: { getPath: () => testState.dir, isPackaged: false },
  safeStorage: { isEncryptionAvailable: () => false },
  BrowserWindow: { fromWebContents: () => null },
  ipcMain: {
    handle: (channel: string, run: (event: unknown, args: unknown) => unknown) =>
      ipc.handlers.set(channel, run),
    removeHandler: (channel: string) => ipc.handlers.delete(channel),
    removeAllListeners: () => undefined,
    on: () => undefined
  }
}))
vi.mock('../../telemetry/client', () => ({ track: vi.fn() }))

// The renderer's ipc dispatcher serves these methods; the real registry is the whole app.
vi.mock('../../runtime/rpc/methods/rpc-method-registry', async () => ({
  ALL_RPC_METHODS: (await import('./mcp-launch-network-transport.test-fixture')).TEST_METHODS
}))

const { parsePairingCode } = await import('../../../shared/remote-runtime/pairing/pairing')
const { addEnvironmentFromPairingCode } =
  await import('../../../shared/remote-runtime/host-store/runtime-environment-store-operations')
const { OrcaRuntimeService } = await import('../../runtime/orca-runtime')
const { OrcaRuntimeRpcServer } = await import('../../runtime/rpc/server/runtime-rpc')
const { RuntimeClient } = await import('../../../cli/runtime/client')
const { applyForkAgentProfile } = await import('../../../cli/fork/agent-profile-flag')
const { AUTOMATION_HANDLERS } = await import('../../../cli/automations/automations')
const { registerRuntimeHandlers } = await import('../../ipc/runtime')
const { installForkAgentProfileLaunch } =
  await import('../agent-profiles/agent-profile-launch-scope')
const { installForkMcpProfiles, uninstallForkMcpProfilesForTests } =
  await import('./mcp-profiles-service')
const { TEST_METHODS, standInLaunches } =
  await import('./mcp-launch-network-transport.test-fixture')

const forkSettings = {
  forkAgentProfiles: [
    { name: 'nightly', agent: 'claude', mcpProfile: 'review-tools', permissionMode: 'accept-edits' }
  ],
  forkMcpProfiles: [{ name: 'review-tools', mode: 'allow', servers: ['lint'] }]
}

let home: string
let repoDir: string
let store: ReturnType<typeof createStore>
let runtime: InstanceType<typeof OrcaRuntimeService>
let server: InstanceType<typeof OrcaRuntimeRpcServer>
let client: InstanceType<typeof RuntimeClient>
let savedConfigDir: string | undefined

beforeAll(async () => {
  testState.dir = mkdtempSync(join(tmpdir(), 'fork-mcp-transport-'))
  home = mkdtempSync(join(tmpdir(), 'fork-mcp-transport-home-'))
  repoDir = join(testState.dir, 'repo')
  mkdirSync(repoDir)
  savedConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = join(testState.dir, 'claude')
  mkdirSync(process.env.CLAUDE_CONFIG_DIR)
  writeFileSync(
    join(process.env.CLAUDE_CONFIG_DIR, '.claude.json'),
    JSON.stringify({ mcpServers: { lint: { command: 'lint-mcp' }, docs: { command: 'docs-mcp' } } })
  )
  store = createStore()
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
  runtime = new OrcaRuntimeService(store as never)
  server = new OrcaRuntimeRpcServer({
    runtime,
    userDataPath: testState.dir,
    enableWebSocket: true,
    wsPort: 0,
    methods: TEST_METHODS
  })
  await server.start()
  const offer = server.createPairingOffer({ address: '127.0.0.1', scope: 'runtime', name: 'Home' })
  if (!offer.available || !parsePairingCode(offer.pairingUrl)) {
    throw new Error('WebSocket pairing unavailable')
  }
  addEnvironmentFromPairingCode(home, { name: 'lab', pairingCode: offer.pairingUrl })
  client = new RuntimeClient(home, 30_000, null, 'lab')
}, 60_000)

afterAll(async () => {
  await server?.stop()
  uninstallForkMcpProfilesForTests()
  await closeTestStores()
  if (savedConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = savedConfigDir
  }
  rmSync(home, { recursive: true, force: true })
  rmSync(testState.dir, { recursive: true, force: true })
})

beforeEach(() => {
  standInLaunches.length = 0
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.mocked(process.stderr.write).mockRestore()
  vi.mocked(console.log).mockRestore()
  for (const automation of store.listAutomations()) {
    store.deleteAutomation(automation.id)
  }
})

/** The profile's kept servers, read from the file the launch names. */
function keptServers(command: string): unknown {
  const file = /'--mcp-config=([^']+)'/.exec(command)?.[1]
  expect(file, command).toBeDefined()
  return JSON.parse(readFileSync(file!, 'utf8'))
}

const LIMITED = { mcpServers: { lint: { command: 'lint-mcp' } } }

type CallClient = { call: (method: string, params?: unknown) => Promise<unknown> }

/** `orca automations create --environment lab` with `flags`: the CLI's own handlers. */
async function cliCreate(
  via: CallClient,
  name: string,
  flags: Record<string, string>
): Promise<void> {
  const all = new Map<string, string | boolean>([
    ...Object.entries(flags),
    ['name', name],
    ['prompt', 'Lint the repo.'],
    ['trigger', 'daily'],
    ['repo', 'id:repo-1'],
    ['workspace-mode', 'new_per_run']
  ])
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler context fields the profile flag and create handler read.
  const ctx = { flags: all, client: via, cwd: repoDir, json: true } as never
  if (all.has('profile')) {
    await applyForkAgentProfile('automations create', ctx)
  }
  await AUTOMATION_HANDLERS['automations create']!(ctx)
}

const LAUNCHES = [
  ['agent.launch', { agent: 'claude' }],
  ['worktree.create', { startupAgent: 'claude' }],
  ['orchestration.workerStart', { agent: 'claude' }]
] as const

describe('launches over the paired WebSocket (BAD-800)', () => {
  it('automations create --profile stores the MCP profile', async () => {
    await cliCreate(client, 'Nightly lint', { profile: 'nightly' })
    expect(store.listAutomations()).toMatchObject([
      { name: 'Nightly lint', forkMcpProfile: 'review-tools' }
    ])
  })

  it('refuses an unknown MCP profile with nothing created', async () => {
    await expect(
      cliCreate(client, 'Unknown', { 'mcp-profile': 'no-such-profile', provider: 'claude' })
    ).rejects.toThrow(/Unknown MCP profile "no-such-profile"/)
    expect(store.listAutomations()).toEqual([])
  })

  it.each(LAUNCHES)('%s applies a --profile MCP limit and mode', async (method, agent) => {
    await client.call(method, {
      ...agent,
      forkAgentProfile: 'nightly',
      forkMcpProfile: 'review-tools'
    })
    expect(standInLaunches).toHaveLength(1)
    expect(standInLaunches[0]).toContain("'--permission-mode' 'acceptEdits'")
    expect(keptServers(standInLaunches[0]!)).toEqual(LIMITED)
  })

  it.each(LAUNCHES)(
    '%s refuses an unknown MCP profile, launching nothing',
    async (method, agent) => {
      await expect(
        client.call(method, { ...agent, forkMcpProfile: 'no-such-profile' })
      ).rejects.toThrow(/Unknown MCP profile "no-such-profile"/)
      expect(standInLaunches).toEqual([])
    }
  )
})

describe("the renderer's ipc subscribe (BAD-800)", () => {
  /** A client whose calls go through `runtime:subscribe`, answered on the sender's channel. */
  function ipcClient(): CallClient {
    registerRuntimeHandlers(runtime)
    let next = 0
    return {
      call: async (method, params) => {
        const replies: { ok: boolean; result?: unknown; error?: { message: string } }[] = []
        const sender = {
          id: 1,
          isDestroyed: () => false,
          send: (_channel: string, reply: (typeof replies)[number]) => replies.push(reply),
          once: () => undefined,
          on: () => undefined
        }
        const event = { sender: { ...sender, mainFrame: 'frame' }, senderFrame: 'frame' }
        next += 1
        ipc.handlers.get('runtime:subscribe')!(event, {
          subscriptionId: `s-${next}`,
          method,
          params
        })
        await vi.waitFor(() => expect(replies).toHaveLength(1))
        const reply = replies[0]!
        if (!reply.ok) {
          throw new Error(reply.error?.message)
        }
        return { result: reply.result }
      }
    }
  }

  it('automations create --profile stores the MCP profile', async () => {
    await cliCreate(ipcClient(), 'Nightly lint', { profile: 'nightly' })
    expect(store.listAutomations()).toMatchObject([
      { name: 'Nightly lint', forkMcpProfile: 'review-tools' }
    ])
  })

  it('refuses an unknown MCP profile with nothing created', async () => {
    await expect(
      cliCreate(ipcClient(), 'Unknown', { 'mcp-profile': 'no-such-profile', provider: 'claude' })
    ).rejects.toThrow(/Unknown MCP profile "no-such-profile"/)
    expect(store.listAutomations()).toEqual([])
  })

  it('runs agent.launch in its launch scope', async () => {
    await ipcClient().call('agent.launch', { agent: 'claude', forkMcpProfile: 'review-tools' })
    expect(keptServers(standInLaunches[0]!)).toEqual(LIMITED)
  })
})
