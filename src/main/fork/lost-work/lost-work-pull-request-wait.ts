// SLRM-2175: the lost work scan's pull request read, started beside the git work and given a time
// limit, so a slow or hung hosting CLI cannot hold a scan. When it runs out of time the scan goes
// on without pull requests and says so, as it does when the CLI is missing.
import type { ResolvedLostWorkSettings } from '../../../shared/fork/lost-work'
import { throwIfWorkspaceCleanupScanAborted } from '../../ipc/workspace-cleanup/workspace-cleanup-scan-primitives'
import type { LostWorkPullRequestLookup, LostWorkPullRequestMap } from './lost-work-pull-requests'

export type LostWorkPullRequestWait = {
  /** False when the check is off or there is no lookup: `get` then resolves null at once. */
  wanted: boolean
  /** The pull requests by branch; null when the read failed or ran out of time. */
  get: () => Promise<LostWorkPullRequestMap | null>
  /** Ends a read nobody waits for any more. */
  stop: () => void
}

export function startLostWorkPullRequests(
  repo: Parameters<LostWorkPullRequestLookup>[0],
  settings: ResolvedLostWorkSettings,
  lookup: LostWorkPullRequestLookup | undefined,
  signal?: AbortSignal
): LostWorkPullRequestWait {
  if (!settings.checks.pullRequests || !lookup) {
    return { wanted: false, get: async () => null, stop: () => {} }
  }
  const controller = new AbortController()
  const stop = () => controller.abort()
  signal?.addEventListener('abort', stop, { once: true })
  if (signal?.aborted) {
    stop()
  }
  const timer = setTimeout(stop, settings.pullRequestTimeoutSeconds * 1000)
  // A lookup that ignores its signal must not hold the scan either.
  const stopped = new Promise<null>((resolve) =>
    controller.signal.addEventListener('abort', () => resolve(null), { once: true })
  )
  const read = Promise.race([
    Promise.resolve()
      .then(() => lookup(repo, settings.pullRequestLimit, controller.signal))
      .catch(() => null),
    stopped
  ]).finally(() => {
    clearTimeout(timer)
    signal?.removeEventListener('abort', stop)
  })
  return {
    wanted: true,
    get: async () => {
      const pullRequests = await read
      throwIfWorkspaceCleanupScanAborted(signal)
      return pullRequests
    },
    stop
  }
}
