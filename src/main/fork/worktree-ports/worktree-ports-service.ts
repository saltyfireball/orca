// Worktree ports (FORK.md, SLRM-2383): the hooks upstream code calls. Every host that runs
// workspaces (the desktop app, `orca serve`, and orcad on a headless server) keeps its own
// reservations: terminals, native chats and setup scripts are all started by the host that runs
// the workspace, so the block is exported there and `orca ports` asks that same host.
//
// A block is reserved the first time a workspace's terminal, agent or setup script starts (a new
// worktree's setup and first terminal do that during its create), and when the create is reported.
// It is released when the workspace is removed, and at start for workspaces gone since.
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import {
  forkWorktreePortBlockEnv,
  forkWorktreePortSetupEnv,
  isForkWorktreePortEnvKey,
  readForkWorktreePortsSettings,
  type ForkWorktreePortBlock,
  type ForkWorktreePortsConfig
} from '../../../shared/fork/worktree-ports'
import { parseWorkspaceKey } from '../../../shared/workspace/identity/workspace-scope'
import { splitWorktreeIdForFilesystem } from '../../../shared/worktree/id'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID
} from '../../../shared/execution-host/execution-host'
import { getCanonicalUserDataPath } from '../../persistence/loading-store/user-data-path'
import { FORK_WORKTREE_PORTS_FILE, ForkWorktreePortRegistry } from './worktree-port-registry'

// Null until this host installs the feature: a process that never does (a tool, a unit test of
// some other module) reserves nothing and writes no file.
let readSettings: (() => unknown) | null = null
let registry: ForkWorktreePortRegistry | null = null
const followed = new WeakSet<object>()

function config(): ForkWorktreePortsConfig {
  return readSettings
    ? readForkWorktreePortsSettings(readSettings())
    : { ...readForkWorktreePortsSettings(null), enabled: false }
}

function getRegistry(): ForkWorktreePortRegistry | null {
  if (!readSettings) {
    return null
  }
  if (!registry) {
    try {
      registry = new ForkWorktreePortRegistry(
        join(getCanonicalUserDataPath(), FORK_WORKTREE_PORTS_FILE)
      )
    } catch {
      // No app environment (a bare test or tool process): nothing to reserve against.
      return null
    }
  }
  return registry
}

/** Tests only: a registry on a temporary file and a settings object. */
export function setForkWorktreePortsForTests(
  next: ForkWorktreePortRegistry | null,
  settings: (() => unknown) | null = null
): void {
  registry = next
  readSettings = settings
}

/** Points the feature at this host's settings, in the desktop app and in orcad alike. Reads nothing yet. */
export function installForkWorktreePorts(store: { getSettings: () => unknown }): void {
  readSettings = () => store.getSettings()
}

/** Plain workspace ids only: a selector or an empty id names no workspace. */
function workspaceIdOf(worktreeId: string | null | undefined): string | null {
  const id = worktreeId?.trim()
  return id && id.length <= 4096 ? id : null
}

/** The workspace's block, reserving one when the feature is on. Null when off or out of ports. */
export function forkWorktreePortBlock(
  worktreeId: string | null | undefined
): ForkWorktreePortBlock | null {
  const id = workspaceIdOf(worktreeId)
  const current = config()
  if (!id || !current.enabled) {
    return null
  }
  try {
    return getRegistry()?.reserve(id, current) ?? null
  } catch (error) {
    // A spawn never fails over ports.
    console.warn('[fork-worktree-ports] Could not reserve a block', error)
    return null
  }
}

/** Terminal env: sets the block's names, and drops stale ones a copied env carried in. */
export function applyForkWorktreePortEnv(
  env: Record<string, string>,
  worktreeId: string | null | undefined
): void {
  for (const key of Object.keys(env)) {
    if (isForkWorktreePortEnvKey(key)) {
      delete env[key]
    }
  }
  const block = forkWorktreePortBlock(worktreeId)
  if (block) {
    Object.assign(env, forkWorktreePortBlockEnv(block))
  }
}

/** Native chat env: the launch env with this workspace's block laid over it. */
export function withForkWorktreePortEnv(
  env: Record<string, string>,
  worktreeId: string | null | undefined
): Record<string, string> {
  const next = { ...env }
  applyForkWorktreePortEnv(next, worktreeId)
  return next
}

/** Setup and archive script env; empty when off or when the script names no workspace. */
export function forkWorktreePortSetupEnvFor(
  worktreeId: string | null | undefined
): Record<string, string> {
  const block = forkWorktreePortBlock(worktreeId)
  return block ? forkWorktreePortSetupEnv(block) : {}
}

/** What `orca ports` shows; reads only, so asking never reserves. */
export function readForkWorktreePortBlock(worktreeId: string): {
  enabled: boolean
  block: ForkWorktreePortBlock | null
} {
  const id = workspaceIdOf(worktreeId)
  return { enabled: config().enabled, block: id ? (getRegistry()?.get(id) ?? null) : null }
}

type LifecycleEvent = { kind: 'created' | 'removed'; worktreeId: string }

/** Desktop IPC and runtime creates and removals both land here; a repeat is harmless. */
export function forkWorktreePortsLifecycle(event: LifecycleEvent): void {
  try {
    if (event.kind === 'created') {
      forkWorktreePortBlock(event.worktreeId)
    } else {
      getRegistry()?.release(event.worktreeId)
    }
  } catch (error) {
    console.warn('[fork-worktree-ports] Lifecycle update failed', error)
  }
}

type RepoRow = {
  id: string
  path: string
  connectionId?: string | null
  executionHostId?: string | null
}

export type ForkWorktreePortsRuntime = {
  onWorktreeLifecycle: (listener: (event: LifecycleEvent) => void) => () => void
  requireStore: () => { getRepos: () => readonly RepoRow[] }
}

/**
 * Keeps a block while its project is known and, for a project on this machine, while its folder
 * exists. Folder workspaces and projects on other hosts are kept: their removal is reported. A
 * project whose own folder cannot be read (a drive or WSL distro not mounted) proves nothing.
 */
async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false
  )
}

export async function forkWorktreePortKeep(
  repos: readonly RepoRow[],
  worktreeId: string,
  pathExists: (path: string) => Promise<boolean> = exists
): Promise<boolean> {
  if (parseWorkspaceKey(worktreeId)?.type === 'folder') {
    return true
  }
  const parsed = splitWorktreeIdForFilesystem(worktreeId)
  if (!parsed) {
    return true
  }
  const owners = repos.filter((repo) => repo.id === parsed.repoId)
  if (owners.length === 0) {
    return false
  }
  for (const repo of owners) {
    const gone =
      getRepoExecutionHostId(repo) === LOCAL_EXECUTION_HOST_ID &&
      (await pathExists(repo.path)) &&
      !(await pathExists(parsed.worktreePath))
    if (!gone) {
      return true
    }
  }
  return false
}

async function pruneGone(
  current: ForkWorktreePortRegistry,
  runtime: ForkWorktreePortsRuntime
): Promise<void> {
  const repos = runtime.requireStore().getRepos()
  const gone = new Set<string>()
  for (const block of current.list()) {
    if (!(await forkWorktreePortKeep(repos, block.worktreeId))) {
      gone.add(block.worktreeId)
    }
  }
  current.prune((block) => !gone.has(block.worktreeId))
}

/**
 * Once the runtime settles: release blocks of workspaces gone while closed, follow removals, and
 * find the first spare block so the next new workspace gets ports bound and found free.
 */
export async function startForkWorktreePorts(runtime: ForkWorktreePortsRuntime): Promise<void> {
  const current = getRegistry()
  if (!current || followed.has(runtime)) {
    return
  }
  followed.add(runtime)
  runtime.onWorktreeLifecycle(forkWorktreePortsLifecycle)
  const range = config()
  if (range.enabled) {
    void current.refreshSpare(range)
  }
  await pruneGone(current, runtime).catch((error: unknown) => {
    console.warn('[fork-worktree-ports] Could not check reservations against projects', error)
  })
}
