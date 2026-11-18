// Auto placement (FORK.md, SLRM-2266): fork.placement.load answers for this machine (its paired
// homes call it as the load probe); fork.placement.pick probes this machine and its paired servers
// and ranks them, for `--on auto`, `--host auto` and `orca placement`.
import { defineMethod, type RpcContext } from '../../core'
import { getAppEnvironment } from '../../../../../shared/app-lifecycle/app-environment'
import { listEnvironments } from '../../../../../shared/remote-runtime/host-store/runtime-environment-store'
import {
  ForkPlacementLoadParams,
  ForkPlacementPickParams,
  type ForkPlacementLoadResult,
  type ForkPlacementPickResult
} from '../../../../../shared/fork/auto-placement-wire'
import {
  forkProjectReadyHere,
  type ForkAutoPlacementSettings
} from '../../../../../shared/fork/auto-placement'
import {
  pickForkPlacementOnHosts,
  readLocalMachineLoad,
  type ForkPlacementDeps
} from '../../../../fork/auto-placement/auto-placement-probe'

function projectReady(ctx: RpcContext, project: string): boolean {
  try {
    return forkProjectReadyHere(
      ctx.runtime.listProjects(),
      ctx.runtime.listVisibleProjectHostSetups(),
      project
    )
  } catch {
    // A host that cannot list its projects has no setup to offer.
    return false
  }
}

async function localLoad(
  ctx: RpcContext,
  repo: string | undefined,
  project: string | undefined
): Promise<ForkPlacementLoadResult> {
  const load = await readLocalMachineLoad()
  const result: ForkPlacementLoadResult = { load }
  if (repo) {
    result.repoFound = await ctx.runtime.showRepo(repo).then(
      () => true,
      () => false
    )
  }
  if (project) {
    result.projectReady = projectReady(ctx, project)
  }
  return result
}

function settings(ctx: RpcContext): ForkAutoPlacementSettings | null {
  try {
    return ctx.runtime.requireStore().getSettings() as ForkAutoPlacementSettings
  } catch {
    // A host without a settings store treats every machine as normal.
    return null
  }
}

/** This host's placement probe wiring; batch start (SLRM-2395) picks through it too. */
export function forkPlacementDeps(ctx: RpcContext): ForkPlacementDeps {
  return {
    settings: () => settings(ctx),
    listEnvironments: () => listEnvironments(getAppEnvironment().getPath('userData')),
    localLoad: (repo, project) => localLoad(ctx, repo, project),
    callEnvironment: (environmentId, method, params, timeoutMs) =>
      ctx.runtime.callOrchestrationWorkerServer(environmentId, method, params, timeoutMs)
  }
}

export const FORK_AUTO_PLACEMENT_METHODS = [
  defineMethod({
    name: 'fork.placement.load',
    permission: 'workspace',
    params: ForkPlacementLoadParams,
    handler: async (params, ctx): Promise<ForkPlacementLoadResult> =>
      localLoad(ctx, params.repo, params.project)
  }),
  defineMethod({
    name: 'fork.placement.pick',
    permission: 'workspace',
    params: ForkPlacementPickParams,
    handler: async (params, ctx): Promise<ForkPlacementPickResult> =>
      pickForkPlacementOnHosts(forkPlacementDeps(ctx), params)
  })
] as const
