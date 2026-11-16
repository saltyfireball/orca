// Auto placement (FORK.md, SLRM-2266): fork.placement.load answers for this machine (its paired
// homes call it as the load probe); fork.placement.pick probes this machine and its paired servers
// and ranks them, for `--on auto`, `--host auto` and `orca placement`.
import { defineMethod, type RpcContext } from '../../core'
import { getAppEnvironment } from '../../../../../shared/app-environment'
import { listEnvironments } from '../../../../../shared/remote-runtime/host-store/runtime-environment-store'
import {
  ForkPlacementLoadParams,
  ForkPlacementPickParams,
  type ForkPlacementLoadResult,
  type ForkPlacementPickResult
} from '../../../../../shared/fork/auto-placement-wire'
import type { ForkAutoPlacementSettings } from '../../../../../shared/fork/auto-placement'
import {
  pickForkPlacementOnHosts,
  readLocalMachineLoad
} from '../../../../fork/auto-placement/auto-placement-probe'

async function localLoad(
  ctx: RpcContext,
  repo: string | undefined
): Promise<ForkPlacementLoadResult> {
  const load = await readLocalMachineLoad()
  if (!repo) {
    return { load }
  }
  const repoFound = await ctx.runtime.showRepo(repo).then(
    () => true,
    () => false
  )
  return { load, repoFound }
}

function settings(ctx: RpcContext): ForkAutoPlacementSettings | null {
  try {
    return ctx.runtime.requireStore().getSettings() as ForkAutoPlacementSettings
  } catch {
    // A host without a settings store treats every machine as normal.
    return null
  }
}

export const FORK_AUTO_PLACEMENT_METHODS = [
  defineMethod({
    name: 'fork.placement.load',
    permission: 'workspace',
    params: ForkPlacementLoadParams,
    handler: async (params, ctx): Promise<ForkPlacementLoadResult> => localLoad(ctx, params.repo)
  }),
  defineMethod({
    name: 'fork.placement.pick',
    permission: 'workspace',
    params: ForkPlacementPickParams,
    handler: async (params, ctx): Promise<ForkPlacementPickResult> =>
      pickForkPlacementOnHosts(
        {
          settings: () => settings(ctx),
          listEnvironments: () => listEnvironments(getAppEnvironment().getPath('userData')),
          localLoad: (repo) => localLoad(ctx, repo),
          callEnvironment: (environmentId, method, params, timeoutMs) =>
            ctx.runtime.callOrchestrationWorkerServer(environmentId, method, params, timeoutMs)
        },
        params
      )
  })
] as const
