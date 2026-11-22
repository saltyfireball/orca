// Keep main current (SLRM-2384, FORK.md): the one MainSyncService of this process, wired to the
// runtime's store, the app's git runner and its workspace rows. Keep electron out of this file.
import { gitExecFileAsync } from '../../git/command-runner/git-exec-file'
import type { RuntimeWorktreePsSummary } from '../../../shared/worktree/catalog/runtime-worktree-contracts'
import type { Repo } from '../../../shared/repository/repo-types'
import type { ForkGlobalSettings } from '../../../shared/fork/fork-global-settings'
import type { ForkMainSyncRepoResult, ForkMainSyncStatus } from '../../../shared/fork/main-sync'
import { sleeperSourcesFromPs } from '../../../shared/fork/sleepers-ps-sources'
import { lostWorkUseFromPs } from '../lost-work/lost-work-use-ps'
import { forkSleeperChatFacts } from '../sleepers/sleepers-host'
import { MainSyncService, type MainSyncSettings } from './main-sync-service'
import type { MainSyncGit } from './main-sync-repo'

export type ForkMainSyncRuntime = {
  requireStore: () => {
    getSettings: () => MainSyncSettings
    getRepos: () => Repo[]
    onSettingsChanged?: (listener: (updates: Partial<ForkGlobalSettings>) => void) => unknown
  }
  getWorktreePs: () => Promise<{ worktrees: RuntimeWorktreePsSummary[] }>
}

let service: MainSyncService | null = null

const git: MainSyncGit = async (args, options) =>
  (
    await gitExecFileAsync(args, {
      cwd: options.cwd,
      signal: options.signal,
      admissionTier: 'background'
    })
  ).stdout

/** Checkouts with live terminals or a working agent, from the runtime's own workspace rows. */
async function inUsePaths(runtime: ForkMainSyncRuntime): Promise<Set<string>> {
  const { worktrees } = await runtime.getWorktreePs()
  const uses = lostWorkUseFromPs(
    worktrees,
    sleeperSourcesFromPs(worktrees, forkSleeperChatFacts(), {
      includeWorkers: true
    })
  )
  const paths = new Set<string>()
  for (const row of worktrees) {
    const use = uses.get(row.worktreeId)
    if (use && (use.agentRunning || use.liveTerminals > 0)) {
      paths.add(row.path)
    }
  }
  return paths
}

export function startForkMainSync(runtime: ForkMainSyncRuntime): void {
  if (service || process.env.VITEST) {
    return
  }
  service = new MainSyncService({
    readSettings: () => runtime.requireStore().getSettings(),
    listRepos: () => runtime.requireStore().getRepos(),
    onSettingsChanged: (listener) => runtime.requireStore().onSettingsChanged?.(listener),
    git,
    inUsePaths: () => inUsePaths(runtime),
    log: (message) => console.warn(message)
  })
  service.start()
}

function requireService(): MainSyncService {
  if (!service) {
    throw new Error('Keep main current has not started on this host yet; try again in a moment.')
  }
  return service
}

export function forkMainSyncStatus(): ForkMainSyncStatus {
  return requireService().status()
}

export function runForkMainSync(only?: string): Promise<ForkMainSyncRepoResult[]> {
  return requireService().run(only)
}
