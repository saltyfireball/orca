// Fork tests of BotController (SLRM-2475 starting rules, launch defaults). Kept apart from upstream's
// bot-controller tests, which upstream cut from its suite.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeTestStores, createStore, testState } from '../persistence/persistence-test-harness'
import type { Store } from '../persistence/loading-store/store'
import { RuntimeProjectGroupController } from '../runtime/repositories/runtime-project-group-controller'
import { BotController, type BotControllerDependencies } from './bot-controller'
import { botsRootFolder, localBotHomeFilesystem } from './bot-home'

const osHome = vi.hoisted(() => ({ dir: '' }))
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  homedir: () => osHome.dir
}))
vi.mock('electron', () => ({ app: { getPath: () => testState.dir } }))
vi.mock('../ssh/config/ssh-config-parser', () => ({
  loadUserSshConfig: vi.fn(() => []),
  sshConfigHostsToTargets: vi.fn(() => [])
}))
vi.mock('../telemetry/client', () => ({ track: vi.fn() }))

describe('BotController (fork)', () => {
  let store: Store
  let bots: BotController

  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-bots-profile-'))
    osHome.dir = mkdtempSync(join(tmpdir(), 'orca-bots-home-'))
    store = createStore()
    const projectGroups = new RuntimeProjectGroupController({
      getStore: () => store,
      resolveRepo: vi.fn(),
      notifyReposChanged: vi.fn(),
      resolveFolderConnectionId: () => null,
      teardownFolderWorkspacePtys: vi.fn(async () => undefined),
      acquireFileWatcherRemoval: vi.fn(async () => ({ finish: async () => undefined })),
      cleanupRemovedFolderWorkspaceState: vi.fn(),
      emitWorktreeLifecycle: vi.fn()
    })
    const createFolderWorkspace: BotControllerDependencies['createFolderWorkspace'] = async (
      input
    ) => (await projectGroups.createFolderWorkspace(input)).folderWorkspace
    bots = new BotController({
      getStore: () => store,
      notifyBotsWritten: vi.fn(),
      createFolderWorkspace,
      deleteFolderWorkspace: vi.fn(async (id: string) => ({
        deleted: store.removeFolderWorkspace(id)
      })),
      deleteBotAutomations: vi.fn(async () => ({ removed: 0 })) as never,
      leaveBotGroups: vi.fn(async () => {}),
      botsRoot: () => botsRootFolder(),
      slackIconsRoot: () => join(botsRootFolder(), '..', 'bot-slack-icons'),
      filesystem: localBotHomeFilesystem,
      forgetBot: vi.fn()
    })
  })

  afterEach(async () => {
    await closeTestStores()
    rmSync(testState.dir, { recursive: true, force: true })
    rmSync(osHome.dir, { recursive: true, force: true })
  })

  it('starts a proposed bot with the fork starting rules when they are set', async () => {
    store.updateSettings({ forkBotStartingRules: '## Never\n\n- Force-push.' })
    await bots.create({ name: 'Milo', seed: { purpose: 'Keeps a list.' } })
    const soul = readFileSync(join(botsRootFolder(), 'milo', 'SOUL.md'), 'utf8')
    expect(soul).toBe('# Milo\n\nKeeps a list.\n\n## Never\n\n- Force-push.\n')
  })

  it('starts a new bot on the fork bot launch default unless it brings its own', async () => {
    store.updateSettings({
      forkLaunchDefaults: { bot: { claude: { model: 'opus', effort: 'medium' } } }
    })
    expect(await bots.create({ name: 'Milo' })).toMatchObject({
      launch: { model: 'opus', options: { effort: 'medium' } }
    })
    expect(await bots.create({ name: 'Router', launch: { model: 'haiku' } })).toMatchObject({
      launch: { model: 'haiku' }
    })
    expect(await bots.create({ name: 'Coder', agent: 'codex' })).not.toHaveProperty('launch')
  })
})
