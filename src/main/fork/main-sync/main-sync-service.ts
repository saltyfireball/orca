// Keep main current (SLRM-2384, FORK.md): the timer that runs a pass over this host's local git
// projects while `forkMainSync` is on, the last result of each project for `orca main-sync` and the
// fork.mainSync.* RPC, and a log line for every move and every new reason a project was left
// alone. Started once per process from runtime-settle-hooks.ts, in the desktop app, `orca serve`
// and orcad alike, so each host keeps its own projects current. Keep electron out of this file.
import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  forkMainSyncWantsProject,
  readForkMainSyncConfig,
  type ForkMainSyncRepoResult,
  type ForkMainSyncSettingsSource,
  type ForkMainSyncStatus
} from '../../../shared/fork/main-sync'
import { resolveLostWorkSettings, type LostWorkSettings } from '../../../shared/fork/lost-work'
import { isFolderRepo } from '../../../shared/repository/repo-kind'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID
} from '../../../shared/execution-host/execution-host'
import type { Repo } from '../../../shared/repository/repo-types'
import type { ForkGlobalSettings } from '../../../shared/fork/fork-global-settings'
import { syncMainSyncRepo, type MainSyncGit, type MainSyncRepo } from './main-sync-repo'

/** First pass after start: let the host finish restoring before it runs git. */
export const MAIN_SYNC_FIRST_DELAY_MS = 2 * 60_000
/** How often the settings are looked at again while the feature is off, with no change signal. */
export const MAIN_SYNC_IDLE_RECHECK_MS = 60_000
/** A pass soon after the feature is turned on or its settings change. */
export const MAIN_SYNC_SETTINGS_CHANGE_DELAY_MS = 10_000

export type MainSyncSettings = ForkMainSyncSettingsSource & { forkLostWork?: LostWorkSettings }

export type MainSyncServiceDeps = {
  readSettings: () => MainSyncSettings
  listRepos: () => readonly Repo[]
  git: MainSyncGit
  /** The store's change signal; without one, the settings are polled while the feature is off. */
  onSettingsChanged?: (listener: (updates: Partial<ForkGlobalSettings>) => void) => unknown
  /** Paths of checkouts with live terminals or a working agent; empty when unknown. */
  inUsePaths?: () => Promise<ReadonlySet<string>>
  /** Tests pass their own; the default asks the file system. */
  pathExists?: (path: string) => Promise<boolean>
  now?: () => number
  log?: (message: string) => void
}

function isLocalGitRepo(repo: Repo): boolean {
  return !isFolderRepo(repo) && getRepoExecutionHostId(repo) === LOCAL_EXECUTION_HOST_ID
}

function toSyncRepo(repo: Repo): MainSyncRepo {
  return { id: repo.id, name: repo.displayName || repo.path, path: repo.path }
}

async function canonical(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return resolve(path)
  }
}

function describe(result: ForkMainSyncRepoResult): string {
  const name = JSON.stringify(result.name.slice(0, 200))
  const where = result.branch ? ` ${result.branch}` : ''
  if (result.outcome === 'updated') {
    return `${name}${where}: ${result.reason} ${result.from ?? '?'}..${result.to ?? '?'} from ${result.remoteRef ?? '?'}`
  }
  return `${name}${where}: ${result.outcome} (${result.reason})${result.detail ? `: ${result.detail}` : ''}`
}

export class MainSyncService {
  private timer: ReturnType<typeof setTimeout> | null = null
  private started = false
  private subscribed = false
  private running: Promise<ForkMainSyncRepoResult[]> | null = null
  private lastRunAt: number | null = null
  private nextRunAt: number | null = null
  private readonly results = new Map<string, ForkMainSyncRepoResult>()

  constructor(private readonly deps: MainSyncServiceDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }

  start(firstDelayMs = MAIN_SYNC_FIRST_DELAY_MS): void {
    if (this.started) {
      return
    }
    this.started = true
    if (!this.subscribed && this.deps.onSettingsChanged) {
      this.subscribed = true
      this.deps.onSettingsChanged((updates) => {
        if (Object.keys(updates).some((key) => key.startsWith('forkMainSync'))) {
          this.reschedule()
        }
      })
    }
    this.schedule(firstDelayMs)
  }

  /** A settings change: the next pass soon when on, none while off. */
  private reschedule(): void {
    if (!this.started) {
      return
    }
    this.clearTimer()
    if (this.config().enabled) {
      this.schedule(MAIN_SYNC_SETTINGS_CHANGE_DELAY_MS)
    } else {
      this.nextRunAt = null
    }
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  stop(): void {
    this.started = false
    this.nextRunAt = null
    this.clearTimer()
  }

  private schedule(delayMs: number): void {
    if (!this.started) {
      return
    }
    this.nextRunAt = this.now() + delayMs
    this.timer = setTimeout(() => void this.tick(), delayMs)
    this.timer.unref?.()
  }

  /** One timer step: a pass when the feature is on, then the next step. Never throws. */
  async tick(): Promise<void> {
    const config = this.config()
    if (config.enabled) {
      await this.run().catch((error: unknown) =>
        this.deps.log?.(`[fork-main-sync] pass failed: ${String(error)}`)
      )
    }
    if (config.enabled) {
      this.schedule(config.intervalMs)
    } else if (!this.subscribed) {
      this.schedule(MAIN_SYNC_IDLE_RECHECK_MS)
    } else {
      // Off: nothing runs until a settings change turns it on.
      this.timer = null
      this.nextRunAt = null
    }
  }

  private config(): ReturnType<typeof readForkMainSyncConfig> {
    try {
      return readForkMainSyncConfig(this.deps.readSettings())
    } catch {
      return readForkMainSyncConfig(null)
    }
  }

  /**
   * One pass now, over `only` (a name, id or path) or the projects the settings name. A pass
   * already under way is joined, not doubled.
   */
  run(only?: string): Promise<ForkMainSyncRepoResult[]> {
    if (this.running) {
      return this.running
    }
    this.running = this.pass(only).finally(() => {
      this.running = null
    })
    return this.running
  }

  private async pass(only?: string): Promise<ForkMainSyncRepoResult[]> {
    const config = this.config()
    const settings = this.deps.readSettings()
    const branches = resolveLostWorkSettings(settings?.forkLostWork).defaultBranches
    const wanted = only ? [only] : config.projects
    const repos = this.deps
      .listRepos()
      .filter(isLocalGitRepo)
      .map(toSyncRepo)
      .filter((repo) => forkMainSyncWantsProject(wanted, repo))
    const inUse = config.skipInUse ? await this.readInUse() : new Set<string>()
    const out: ForkMainSyncRepoResult[] = []
    for (const repo of repos) {
      const result = await syncMainSyncRepo(
        {
          git: this.deps.git,
          defaultBranchOverride: (repoId) => branches[repoId],
          isCheckoutInUse: (path) => inUse.has(resolve(path)),
          pathExists: this.deps.pathExists,
          now: () => this.now()
        },
        repo
      )
      this.note(result)
      out.push(result)
    }
    this.lastRunAt = this.now()
    return out
  }

  private async readInUse(): Promise<Set<string>> {
    try {
      const paths = (await this.deps.inUsePaths?.()) ?? new Set<string>()
      return new Set(await Promise.all([...paths].map(canonical)))
    } catch {
      return new Set()
    }
  }

  private note(result: ForkMainSyncRepoResult): void {
    const before = this.results.get(result.repoId)
    this.results.set(result.repoId, result)
    const quietRepeat =
      result.outcome !== 'updated' &&
      before?.outcome === result.outcome &&
      before.reason === result.reason
    if (!quietRepeat && result.reason !== 'up-to-date') {
      this.deps.log?.(`[fork-main-sync] ${describe(result)}`)
    }
  }

  status(): ForkMainSyncStatus {
    const config = this.config()
    const known = new Set(
      this.deps
        .listRepos()
        .filter(isLocalGitRepo)
        .map((repo) => repo.id)
    )
    return {
      enabled: config.enabled,
      intervalMinutes: Math.round(config.intervalMs / 60_000),
      projects: config.projects,
      skipInUse: config.skipInUse,
      running: this.running !== null,
      lastRunAt: this.lastRunAt,
      nextRunAt: config.enabled ? this.nextRunAt : null,
      results: [...this.results.values()].filter((result) => known.has(result.repoId))
    }
  }
}
