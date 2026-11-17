// Server updates (FORK.md, SLRM-2310). On a server: fork.serverUpdate.status (workspace, read-only)
// and .apply / .rollback (host-admin: they make this host download and run new code). On a
// desktop: fork.servers.list (workspace) and .update / .rollback (host-admin), which call those on
// each paired server in turn, and .run to follow one. Neither side takes an address or a checksum
// from the caller; the server reads its release address and signer pin from its own settings.
import { defineMethod, type RpcContext } from '../../core'
import { getAppEnvironment } from '../../../../../shared/app-lifecycle/app-environment'
import {
  isForkReleaseVersion,
  pickForkServerUpdateSettings,
  type ForkServerUpdateSettings
} from '../../../../../shared/fork/server-update'
import {
  ForkServersListParams,
  ForkServersRollbackParams,
  ForkServersRunParams,
  ForkServersUpdateParams,
  ForkServerUpdateApplyParams,
  ForkServerUpdateRollbackParams,
  ForkServerUpdateStatusParams,
  type ForkServersListResult,
  type ForkServersRunResult,
  type ForkServerUpdateStartResult,
  type ForkServerUpdateStatus
} from '../../../../../shared/fork/server-update-wire'
import { liveForkServerUpdater } from '../../../../fork/server-update/server-update-live'
import { listForkServers } from '../../../../fork/server-update/servers-fleet'
import { forkServersDeps, liveForkServersRuns } from '../../../../fork/server-update/servers-live'

function settings(ctx: RpcContext): ForkServerUpdateSettings | null {
  try {
    return pickForkServerUpdateSettings(ctx.runtime.requireStore().getSettings())
  } catch {
    return null
  }
}

export const FORK_SERVER_UPDATE_METHODS = [
  defineMethod({
    name: 'fork.serverUpdate.status',
    permission: 'workspace',
    params: ForkServerUpdateStatusParams,
    handler: async (_params, ctx): Promise<ForkServerUpdateStatus> =>
      liveForkServerUpdater().status(settings(ctx))
  }),
  defineMethod({
    name: 'fork.serverUpdate.apply',
    permission: 'host-admin',
    params: ForkServerUpdateApplyParams,
    handler: async (params, ctx): Promise<ForkServerUpdateStartResult> =>
      liveForkServerUpdater().apply(settings(ctx), params)
  }),
  defineMethod({
    name: 'fork.serverUpdate.rollback',
    permission: 'host-admin',
    params: ForkServerUpdateRollbackParams,
    handler: async (params, ctx): Promise<ForkServerUpdateStartResult> =>
      liveForkServerUpdater().rollback(settings(ctx), params)
  }),
  defineMethod({
    name: 'fork.servers.list',
    permission: 'workspace',
    params: ForkServersListParams,
    handler: async (_params, ctx): Promise<ForkServersListResult> =>
      listForkServers(forkServersDeps(ctx.runtime))
  }),
  defineMethod({
    name: 'fork.servers.update',
    permission: 'host-admin',
    params: ForkServersUpdateParams,
    handler: async (params, ctx): Promise<ForkServersRunResult> => {
      const version = params.version ?? getAppEnvironment().getVersion()
      if (!params.all && !params.servers?.length) {
        throw new Error('name the servers to update, or ask for all of them')
      }
      if (!isForkReleaseVersion(version)) {
        throw new Error(
          `${version} is not a release version (this desktop may be a local build); name one to install`
        )
      }
      return liveForkServersRuns(ctx.runtime).start(
        {
          kind: 'update',
          version,
          servers: params.all ? undefined : params.servers,
          allowDowngrade: params.allowDowngrade,
          now: params.now,
          waitMinutes: params.waitMinutes
        },
        version
      )
    }
  }),
  defineMethod({
    name: 'fork.servers.rollback',
    permission: 'host-admin',
    params: ForkServersRollbackParams,
    handler: async (params, ctx): Promise<ForkServersRunResult> =>
      liveForkServersRuns(ctx.runtime).start(
        {
          kind: 'rollback',
          servers: [params.server],
          now: params.now,
          waitMinutes: params.waitMinutes
        },
        ''
      )
  }),
  defineMethod({
    name: 'fork.servers.run',
    permission: 'workspace',
    params: ForkServersRunParams,
    handler: async (params, ctx): Promise<ForkServersRunResult> => {
      const run = liveForkServersRuns(ctx.runtime).get(params.runId)
      if (!run) {
        throw new Error(`no server update run ${params.runId} on this desktop`)
      }
      return run
    }
  })
] as const
