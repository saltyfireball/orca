// Server updates (FORK.md, SLRM-2310): the server side. A paired desktop asks for a version; this
// server downloads it beside its install, checks it (checksum, and on macOS the signer pin and
// bundle id), waits until no turn is running, swaps it in with the old install kept, and restarts
// its service through a watchdog that puts the old install back if the new one does not come up.
// One job at a time; tests pass fakes for every outside effect.
import { join } from 'node:path'
import {
  compareForkVersions,
  isForkReleaseVersion,
  readForkServerUpdateConfig,
  type ForkServerUpdateConfig,
  type ForkServerUpdateSettings
} from '../../../shared/fork/server-update'
import type {
  ForkServerUpdateJob,
  ForkServerUpdateStartResult,
  ForkServerUpdateStatus
} from '../../../shared/fork/server-update-wire'
import type { ForkFetch } from './server-update-fetch'
import {
  findForkServerInstall,
  isForkInstallWritable,
  readInstallVersion,
  type ForkServerInstall
} from './server-update-install'
import {
  forkServiceRestartArgv,
  startForkUpdateWatchdog,
  type ForkSpawnDetached
} from './server-update-restart'
import {
  forkUpdatePreviousPath,
  forkUpdateWorkDir,
  checkForkMacSigner,
  checkForkUpdateOwned,
  prepareForkUpdateWorkDir,
  stageForkLinuxRelease,
  stageForkMacRelease,
  swapForkPrevious,
  swapInForkRelease,
  type ForkRun
} from './server-update-stage'
import {
  clearForkServerUpdateReady,
  forkServerUpdateReadyPath,
  readForkServerUpdateState,
  writeForkServerUpdateState
} from './server-update-state'

const TURN_POLL_MS = 2_000
const ACTIVE = new Set(['downloading', 'verifying', 'waiting', 'restarting'])

export type ForkServerUpdaterDeps = {
  userDataPath: () => string
  /** The host's own version (orcad: a build string, not a release). */
  version: () => string
  /** The release used when no install is resolved; `version` when left out. */
  releaseVersion?: () => string
  platform: NodeJS.Platform
  arch: string
  homeDir: string
  configHome?: string
  uid: number | null
  /** Turns running on this server now: a chat at work or with a live sub-agent or command. */
  busyTurns: () => number
  fetch: ForkFetch
  run: ForkRun
  spawnDetached: ForkSpawnDetached
  now: () => number
  sleep: (ms: number) => Promise<void>
  newId: () => string
  /** Where the update writes go; true when this user may replace `path`. */
  writable?: (path: string) => Promise<boolean>
  installVersion?: (kind: ForkServerInstall['kind'], path: string) => Promise<string | null>
}

export type ForkServerUpdateRequest = {
  version?: string
  allowDowngrade?: boolean
  now?: boolean
  waitMinutes?: number
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 600)
}

export function createForkServerUpdater(deps: ForkServerUpdaterDeps) {
  let job: ForkServerUpdateJob | null = null
  // Held from the first await of a request until its job exists, so two requests never both pass.
  let admitting = false
  const installVersion = deps.installVersion ?? readInstallVersion
  const writable = deps.writable ?? isForkInstallWritable

  const lookup = (): Promise<ForkServerInstall | { problem: string }> =>
    findForkServerInstall({
      platform: deps.platform,
      homeDir: deps.homeDir,
      configHome: deps.configHome,
      userDataPath: deps.userDataPath()
    })

  // The resolved install's own release (what an update checks against), never orcad's build.
  const releaseOf = async (found: ForkServerInstall | null): Promise<string> =>
    (found ? await installVersion(found.kind, found.path) : null) ??
    (deps.releaseVersion ?? deps.version)()

  const update = (patch: Partial<ForkServerUpdateJob>): void => {
    if (job) {
      job = { ...job, ...patch, updatedAt: deps.now() }
    }
  }

  const config = (settings: ForkServerUpdateSettings | null): ForkServerUpdateConfig => {
    const read = readForkServerUpdateConfig(settings)
    if ('error' in read) {
      throw new Error(read.error)
    }
    return read
  }

  /** Validates everything a request can be refused for, before any job starts. */
  const admit = async (settings: ForkServerUpdateSettings | null) => {
    const conf = config(settings)
    if (!conf.accept) {
      throw new Error('this server does not take update requests (forkServerUpdateAccept is off)')
    }
    if (admitting || (job && ACTIVE.has(job.phase))) {
      throw new Error('an update or rollback is already running here')
    }
    admitting = true
    try {
      const install = await lookup()
      if ('problem' in install) {
        throw new Error(install.problem)
      }
      if ((await installVersion(install.kind, install.path)) === null) {
        throw new Error(
          `${install.path} is not a Blackfish install, so it is not updated from here`
        )
      }
      if (!(await writable(install.path))) {
        throw new Error(`this user cannot replace ${install.path}`)
      }
      return { conf, install }
    } catch (error) {
      admitting = false
      throw error
    }
  }

  /** Waits until no turn runs, or the wait runs out; returns false when it ran out. */
  const waitForTurns = async (request: ForkServerUpdateRequest, conf: ForkServerUpdateConfig) => {
    update({ phase: 'waiting' })
    if (request.now) {
      return true
    }
    const deadline = deps.now() + (request.waitMinutes ?? conf.turnWaitMinutes) * 60_000
    while (true) {
      const busy = deps.busyTurns()
      update({ busy })
      if (busy === 0) {
        return true
      }
      if (deps.now() >= deadline) {
        return false
      }
      await deps.sleep(TURN_POLL_MS)
    }
  }

  const restart = async (install: ForkServerInstall, conf: ForkServerUpdateConfig) => {
    const userData = deps.userDataPath()
    const workDir = forkUpdateWorkDir(install.path)
    update({ phase: 'restarting', busy: undefined })
    if (job) {
      await writeForkServerUpdateState(userData, job)
    }
    await clearForkServerUpdateReady(userData)
    startForkUpdateWatchdog(
      {
        readyMark: forkServerUpdateReadyPath(userData),
        want: job?.id ?? '',
        readySeconds: conf.readySeconds,
        rollback: conf.autoRollback,
        installPath: install.path,
        previousPath: forkUpdatePreviousPath(workDir),
        failedPath: join(workDir, 'failed'),
        brakePath: join(userData, 'serve-supervisor-brake.json'),
        restart: forkServiceRestartArgv(install.service, deps.uid ?? 0)
      },
      deps.spawnDetached
    )
  }

  const runJob = async (
    work: () => Promise<void>,
    install: ForkServerInstall,
    conf: ForkServerUpdateConfig,
    request: ForkServerUpdateRequest,
    swap: () => Promise<void>
  ): Promise<void> => {
    try {
      await work()
      if (!(await waitForTurns(request, conf))) {
        update({
          phase: 'failed',
          message: `${job?.busy ?? 0} turns were still running after the wait; nothing was changed (try again, or use --now)`
        })
        return
      }
      await swap()
      await restart(install, conf)
    } catch (error) {
      update({ phase: 'failed', message: errorText(error), busy: undefined })
    }
  }

  const begin = (kind: ForkServerUpdateJob['kind'], fromVersion: string, targetVersion: string) => {
    const now = deps.now()
    job = {
      id: deps.newId(),
      kind,
      phase: 'downloading',
      fromVersion,
      targetVersion,
      startedAt: now,
      updatedAt: now
    }
    admitting = false
    return job
  }

  return {
    async status(settings: ForkServerUpdateSettings | null): Promise<ForkServerUpdateStatus> {
      const read = readForkServerUpdateConfig(settings)
      const install = await lookup()
      const found = 'problem' in install ? null : install
      const version = await releaseOf(found)
      const build = deps.version() // orcad's `0.1.0+<hash>`; a release host has none apart
      return {
        version,
        ...(build !== version && !isForkReleaseVersion(build) ? { buildVersion: build } : {}),
        platform: deps.platform,
        arch: deps.arch,
        install: found ? { kind: found.kind, path: found.path, service: found.service.name } : null,
        ...('problem' in install ? { problem: install.problem } : {}),
        ...('error' in read ? { problem: read.error } : {}),
        accept: !('error' in read) && read.accept,
        previousVersion: found
          ? await installVersion(found.kind, forkUpdatePreviousPath(forkUpdateWorkDir(found.path)))
          : null,
        job: job ?? (await readForkServerUpdateState(deps.userDataPath()))
      }
    },

    async apply(
      settings: ForkServerUpdateSettings | null,
      request: ForkServerUpdateRequest & { version: string }
    ): Promise<ForkServerUpdateStartResult> {
      const resolved = await lookup()
      const running = await releaseOf('problem' in resolved ? null : resolved)
      const order = compareForkVersions(request.version, running)
      if (order === 0) {
        return { current: true }
      }
      if ((order === null || order < 0) && !request.allowDowngrade) {
        // Checked before admit, so a refused downgrade never touches the work folder.
        config(settings)
        throw new Error(
          `refusing to go from ${running} to ${request.version}: that is not newer (pass --allow-downgrade to do it anyway)`
        )
      }
      const { conf, install } = await admit(settings)
      const started = begin('update', running, request.version)
      const workDir = forkUpdateWorkDir(install.path)
      let staged = ''
      const stage = async (): Promise<void> => {
        await prepareForkUpdateWorkDir(workDir, deps.uid)
        const stageDeps = { fetch: deps.fetch, run: deps.run }
        staged =
          install.kind === 'mac-app'
            ? await stageForkMacRelease(stageDeps, {
                releasesUrl: conf.releasesUrl,
                requirement: conf.macRequirement,
                version: request.version,
                workDir
              })
            : await stageForkLinuxRelease(stageDeps, {
                releasesUrl: conf.releasesUrl,
                version: request.version,
                workDir,
                arch: deps.arch
              })
        update({ phase: 'verifying', message: 'downloaded and checked' })
      }
      void runJob(stage, install, conf, request, () =>
        swapInForkRelease(install.path, staged, workDir)
      )
      return { job: started }
    },

    async rollback(
      settings: ForkServerUpdateSettings | null,
      request: ForkServerUpdateRequest
    ): Promise<ForkServerUpdateStartResult> {
      const { conf, install } = await admit(settings)
      const workDir = forkUpdateWorkDir(install.path)
      const previous = await installVersion(install.kind, forkUpdatePreviousPath(workDir))
      if (!previous) {
        admitting = false
        throw new Error('no earlier version is kept on this server')
      }
      const started = begin('rollback', await releaseOf(install), previous)
      // The kept install is run again: check the folder is ours and, on macOS, its signer.
      const check = async (): Promise<void> => {
        await checkForkUpdateOwned(workDir, deps.uid)
        await checkForkUpdateOwned(forkUpdatePreviousPath(workDir), deps.uid)
        if (install.kind === 'mac-app') {
          await checkForkMacSigner(deps.run, forkUpdatePreviousPath(workDir), conf.macRequirement)
        }
      }
      void runJob(check, install, conf, request, () => swapForkPrevious(install.path, workDir))
      return { job: started }
    }
  }
}

export type ForkServerUpdater = ReturnType<typeof createForkServerUpdater>
