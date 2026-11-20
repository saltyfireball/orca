// Worker archive (FORK.md, BAD-669): the paired servers' part of a cleanup. Each server owns its
// own workspaces and archives them itself on its timer; a manual cleanup with includeRemote asks
// every server to run its own pass (fork.workerCleanup.run) and shows what each answered. A
// server that does not answer, or runs a build without the method, is listed as such.
import { mapWithConcurrency } from '../../../shared/concurrency/map-with-concurrency'
import {
  FORK_WORKER_CLEANUP_RUN_METHOD,
  FORK_WORKER_CLEANUP_SERVER_TIMEOUT_MS,
  type ForkWorkerCleanupResult,
  type ForkWorkerCleanupRunParams
} from '../../../shared/fork/worker-archive'
import { parseForkWorkerCleanupResult } from '../../../shared/fork/worker-archive-parse'

const SERVER_CONCURRENCY = 4

export type WorkerArchiveRemoteDeps = {
  listEnvironments: () =>
    | readonly { id: string; name: string }[]
    | Promise<readonly { id: string; name: string }[]>
  callEnvironment: (
    environmentId: string,
    method: string,
    params: unknown,
    timeoutMs: number
  ) => Promise<unknown>
}

function errorText(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'method_not_found'
  ) {
    return 'This server has no worker cleanup. Update it and try again.'
  }
  return error instanceof Error ? error.message : String(error)
}

export async function cleanUpPairedServers(
  deps: WorkerArchiveRemoteDeps,
  params: ForkWorkerCleanupRunParams
): Promise<ForkWorkerCleanupResult['servers']> {
  const environments = await Promise.resolve(deps.listEnvironments()).catch(() => [])
  return mapWithConcurrency(environments, SERVER_CONCURRENCY, async (environment) => {
    try {
      const answer = await deps.callEnvironment(
        environment.id,
        FORK_WORKER_CLEANUP_RUN_METHOD,
        { ...params, includeRemote: false },
        FORK_WORKER_CLEANUP_SERVER_TIMEOUT_MS
      )
      const result = parseForkWorkerCleanupResult(answer)
      if (!result) {
        return {
          name: environment.name,
          environmentId: environment.id,
          ok: false,
          error: 'unreadable answer',
          rows: []
        }
      }
      return {
        name: environment.name,
        environmentId: environment.id,
        ok: true,
        rows: result.rows.map((row) => ({ ...row, server: environment.name }))
      }
    } catch (error) {
      return {
        name: environment.name,
        environmentId: environment.id,
        ok: false,
        error: errorText(error),
        rows: []
      }
    }
  })
}
