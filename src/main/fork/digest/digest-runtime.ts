// Digest (SLRM-2388, FORK.md): the digest wired to a runtime (the desktop app, `orca serve` and
// orcad), and the start of the daily send (digest-schedule.ts). Keep electron out of this file:
// orcad loads it too, and the desktop notification comes through the notify targets' slot.
import { listEnvironments } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import { isFolderRepo } from '../../../shared/repository/repo-kind'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID
} from '../../../shared/execution-host/execution-host'
import type { Repo } from '../../../shared/repository/repo-types'
import {
  forkDigestWindowStart,
  readForkDigestConfig,
  type ForkDigest,
  type ForkDigestCollectParams,
  type ForkDigestLocalParams,
  type ForkDigestSection
} from '../../../shared/fork/digest'
import { getCanonicalUserDataPath } from '../../persistence/loading-store/user-data-path'
import { ghExecFileAsync } from '../../git/command-runner/hosted-cli/gh-exec-file'
import { startForkBackoffTimer } from '../fork-backoff-timer'
import { sendForkNotifyTargets } from '../idle-recovery/idle-recovery-notify'
import { listIdleRecoveryInbox } from '../idle-recovery/idle-recovery-service'
import { listForkServerHealth } from '../server-health/server-health-service'
import { forkUsageReport } from '../usage-ledger/usage-report-service'
import { collectForkDigest } from './digest-collect'
import { readForkDigestLocal } from './digest-local'
import { readForkDigestPullRequests, type ForkDigestRepo } from './digest-pull-requests'
import { readForkDigestTasks, type ForkDigestTaskDb } from './digest-tasks'
import { readForkDigestLastSentAt, runForkDigestTick } from './digest-schedule'
import { boundedForkPairedCall } from '../paired-server-call/paired-server-call'

export type ForkDigestRuntime = {
  requireStore: () => { getSettings: () => unknown; getRepos: () => Repo[] }
  getOrchestrationDb: () => { db: ForkDigestTaskDb }
  callOrchestrationWorkerServer: (
    environmentId: string,
    method: string,
    params: unknown,
    timeoutMs: number
  ) => Promise<unknown>
}

const TICK_MS = 60_000
const IDLE_MAX_MS = 5 * 60_000

function settingsOf(runtime: ForkDigestRuntime): Record<string, unknown> | null {
  try {
    const settings = runtime.requireStore().getSettings()
    return typeof settings === 'object' && settings !== null ? { ...settings } : null
  } catch {
    // A host without a settings store keeps every default.
    return null
  }
}

function localRepos(runtime: ForkDigestRuntime): ForkDigestRepo[] {
  return runtime
    .requireStore()
    .getRepos()
    .filter(
      (repo) => !isFolderRepo(repo) && getRepoExecutionHostId(repo) === LOCAL_EXECUTION_HOST_ID
    )
    .map((repo) => ({
      name: repo.displayName || repo.path,
      path: repo.path,
      ...(repo.ghAccount ? { ghAccount: repo.ghAccount } : {})
    }))
}

/** This host's own part: fork.digest.local, and the first part of every collected digest. */
export function readForkDigestLocalPart(
  runtime: ForkDigestRuntime,
  params: ForkDigestLocalParams
): Promise<ForkDigestSection> {
  return readForkDigestLocal(
    {
      now: Date.now,
      tasks: (since) => readForkDigestTasks(runtime.getOrchestrationDb().db, since),
      pullRequests: (since) =>
        readForkDigestPullRequests(localRepos(runtime), since, async (args, repo, signal) => {
          const { stdout } = await ghExecFileAsync(args, {
            cwd: repo.path,
            signal,
            ...(repo.ghAccount ? { ghAccount: repo.ghAccount } : {})
          })
          return stdout
        }),
      inbox: listIdleRecoveryInbox,
      usage: (days) => forkUsageReport({ by: 'day', days })
    },
    params
  )
}

function serversDown(): { name: string; downSince: number }[] {
  return listForkServerHealth().servers.flatMap((server) =>
    (server.state === 'down' || server.state === 'offline') && server.downSince !== null
      ? [{ name: server.name, downSince: server.downSince }]
      : []
  )
}

const inFlight = new Map<string, Promise<ForkDigest>>()

/**
 * fork.digest.collect: this host and every paired server, since the time asked or the last digest.
 * Callers asking for the same window while one read runs share it, so a client that asks again
 * and again never piles up gh processes and server calls.
 */
export function collectForkDigestOn(
  runtime: ForkDigestRuntime,
  params: ForkDigestCollectParams
): Promise<ForkDigest> {
  const key = params.since === undefined ? 'last' : String(params.since)
  const running = inFlight.get(key)
  if (running) {
    return running
  }
  const read = readForkDigestOn(runtime, params).finally(() => inFlight.delete(key))
  inFlight.set(key, read)
  return read
}

async function readForkDigestOn(
  runtime: ForkDigestRuntime,
  params: ForkDigestCollectParams
): Promise<ForkDigest> {
  const now = Date.now()
  const lastSentAt =
    params.since === undefined ? await readForkDigestLastSentAt(getCanonicalUserDataPath()) : null
  const local: ForkDigestLocalParams = {
    since: forkDigestWindowStart(now, params.since, lastSentAt),
    pullRequests: readForkDigestConfig(settingsOf(runtime)).pullRequests
  }
  return collectForkDigest(
    {
      now: Date.now,
      local: (asked) => readForkDigestLocalPart(runtime, asked),
      listEnvironments: () => listEnvironments(getCanonicalUserDataPath()),
      // Bounded by its own deadline: a server stuck connecting is not waited on (SLRM-2447).
      callEnvironment: boundedForkPairedCall((environmentId, method, callParams, timeoutMs) =>
        runtime.callOrchestrationWorkerServer(environmentId, method, callParams, timeoutMs)
      ),
      serversDown
    },
    local
  )
}

let started = false

/** Starts the daily digest check; once per process, never under tests. */
export function startForkDigest(runtime: ForkDigestRuntime): void {
  if (started || process.env.VITEST) {
    return
  }
  started = true
  const userData = getCanonicalUserDataPath()
  startForkBackoffTimer({
    run: () =>
      runForkDigestTick(
        {
          settings: () => settingsOf(runtime),
          collect: (since) => collectForkDigestOn(runtime, { since }),
          send: sendForkNotifyTargets
        },
        userData,
        Date.now()
      ),
    baseMs: TICK_MS,
    maxMs: IDLE_MAX_MS,
    onError: (error) => console.warn('[fork-digest] the daily digest failed:', error)
  })
}
