// Branch clashes (FORK.md, SLRM-2394): fork.clashes.local answers with this host's own unmerged
// worktree branches (its paired desktop asks it); fork.clashes.scan folds this host's and its
// paired servers' reports into clashes, for `orca clashes`.
import { defineMethod } from '../../core'
import { FORK_COMPLETION_CONTRACT_METHODS } from './fork-completion-contract'
import {
  buildForkClashes,
  forkClashRepoMatches,
  type ForkClashHostReport,
  type ForkClashResult
} from '../../../../../shared/fork/branch-clashes'
import {
  ForkClashesLocalParams,
  ForkClashesScanParams
} from '../../../../../shared/fork/branch-clashes-wire'
import { scanForkClashesHere } from '../../../../fork/branch-clashes/branch-clashes-host'
import { gatherForkClashes } from '../../../../fork/branch-clashes/branch-clashes-fleet'
import {
  forkClashesLatest,
  forkClashFleetDeps,
  runForkClashCheck
} from '../../../../fork/branch-clashes/branch-clashes-state'

/** The last full check narrowed to one project, without reading git again. */
function narrowed(result: ForkClashResult, project: string | undefined): ForkClashResult {
  if (!project) {
    return result
  }
  return {
    ...result,
    projects: result.projects.filter((entry) =>
      forkClashRepoMatches({ repoId: '', name: entry.name, projectKey: entry.projectKey }, project)
    )
  }
}

export const FORK_BRANCH_CLASHES_METHODS = [
  defineMethod({
    name: 'fork.clashes.local',
    permission: 'workspace',
    params: ForkClashesLocalParams,
    handler: async (params, ctx): Promise<ForkClashHostReport> =>
      scanForkClashesHere(ctx.runtime.requireStore(), params.project)
  }),
  defineMethod({
    name: 'fork.clashes.scan',
    permission: 'workspace',
    params: ForkClashesScanParams,
    handler: async (params, ctx): Promise<ForkClashResult> => {
      const deps = forkClashFleetDeps(ctx.runtime)
      const config = deps.config()
      if (!config.enabled) {
        return {
          ...buildForkClashes([], config.behindThreshold, Date.now()),
          hosts: [{ hostId: 'local', hostName: 'this machine', status: 'off' }]
        }
      }
      const latest = forkClashesLatest()
      const fresh = latest && Date.now() - latest.scannedAt < config.intervalMinutes * 60_000
      if (latest && fresh && !params.refresh) {
        return narrowed(latest, params.project)
      }
      // A full check is kept for the sidebar; a one-project check is only answered.
      return params.project ? gatherForkClashes(deps, params.project) : runForkClashCheck(deps)
    }
  }),
  // BAD-676: `fork.completionContract.show` rides in this list so the full registry file stays as it is.
  ...FORK_COMPLETION_CONTRACT_METHODS
] as const
