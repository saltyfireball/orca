// Worker archive (FORK.md, BAD-669): `orca orchestration worker-cleanup`, the "Clean up finished
// workers" actions and the sidebar's held reasons. `run` removes (or, as a dry run, lists) the
// finished workers' own workspaces on this host; with includeRemote it asks every paired server
// for its own part, since each server owns and archives its own workspaces.
import { defineMethod, type RpcContext } from '../../core'
import { getAppEnvironment } from '../../../../../shared/app-lifecycle/app-environment'
import { listEnvironments } from '../../../../../shared/remote-runtime/host-store/runtime-environment-store'
import {
  FORK_WORKER_CLEANUP_RUN_METHOD,
  ForkWorkerArchiveFocusParams,
  ForkWorkerArchiveStatusParams,
  ForkWorkerCleanupRunParams,
  type ForkWorkerCleanupResult
} from '../../../../../shared/fork/worker-archive'
import { boundedForkPairedCall } from '../../../../fork/paired-server-call/paired-server-call'
import { cleanUpPairedServers } from '../../../../fork/worker-archive/worker-archive-remote'
import { noteForkWorkspaceFocus } from '../../../../fork/worker-archive/worker-archive-activity'
import {
  readForkWorkerArchiveStatus,
  runForkWorkerCleanupLocal
} from '../../../../fork/worker-archive/worker-archive-service'

async function withServers(
  local: ForkWorkerCleanupResult,
  params: ForkWorkerCleanupRunParams,
  ctx: RpcContext
): Promise<ForkWorkerCleanupResult> {
  const call = boundedForkPairedCall((environmentId, method, callParams, timeoutMs) =>
    ctx.runtime.callOrchestrationWorkerServer(environmentId, method, callParams, timeoutMs)
  )
  const servers = await cleanUpPairedServers(
    {
      listEnvironments: () => listEnvironments(getAppEnvironment().getPath('userData')),
      callEnvironment: call
    },
    params
  )
  return { ...local, servers }
}

export const FORK_WORKER_CLEANUP_METHODS = [
  defineMethod({
    name: FORK_WORKER_CLEANUP_RUN_METHOD,
    permission: 'workspace',
    params: ForkWorkerCleanupRunParams,
    handler: async (params, ctx): Promise<ForkWorkerCleanupResult> => {
      const local = await runForkWorkerCleanupLocal(ctx.runtime, {
        dryRun: params.dryRun === true,
        ...(params.bot !== undefined ? { bot: params.bot } : {}),
        ...(params.force ? { force: params.force } : {}),
        ...(params.only ? { only: params.only } : {})
      })
      return params.includeRemote ? withServers(local, params, ctx) : local
    }
  }),
  defineMethod({
    name: 'fork.workerCleanup.status',
    permission: 'workspace',
    params: ForkWorkerArchiveStatusParams,
    handler: () => ({ status: readForkWorkerArchiveStatus() })
  }),
  defineMethod({
    name: 'fork.workerCleanup.focus',
    permission: 'workspace',
    params: ForkWorkerArchiveFocusParams,
    handler: (params) => {
      noteForkWorkspaceFocus(params.clientId, params.worktreeId)
      return { ok: true }
    }
  })
] as const
