// Pooled limits (FORK.md, SLRM-2392): fork.limits.machineUsage answers for this machine (its paired
// desktops call it), fork.limits.usage pools this machine and its paired servers for the usage
// popover, /usage-limits and `orca limits usage`. Both carry usage numbers only.
import { defineMethod, type RpcContext } from '../../core'
import { getAppEnvironment } from '../../../../../shared/app-lifecycle/app-environment'
import { listEnvironments } from '../../../../../shared/remote-runtime/host-store/runtime-environment-store'
import {
  ForkMachineUsageParams,
  ForkPooledLimitsParams,
  type ForkMachineUsageResult,
  type ForkPooledLimitsResult,
  type ForkPooledLimitsSettings
} from '../../../../../shared/fork/pooled-limits'
import {
  readForkMachineUsage,
  readForkPooledLimits,
  type PooledLimitsDeps
} from '../../../../fork/pooled-limits/pooled-limits-service'
import {
  claudeStateFileAsync,
  readClaudeFolderLoginAsync
} from '../../../../claude-accounts/sign-in/claude-account-folder'

function deps(ctx: RpcContext): PooledLimitsDeps {
  return {
    settings: () => {
      try {
        return ctx.runtime.requireStore().getSettings() as ForkPooledLimitsSettings
      } catch {
        // A host without a settings store keeps the defaults.
        return null
      }
    },
    snapshot: () => {
      try {
        return ctx.runtime.getAccountsSnapshot()
      } catch {
        // A host without account services has no accounts of its own to report.
        return null
      }
    },
    refresh: () => ctx.runtime.refreshAccountsForMobileSubscriber(),
    defaultClaudeLogin: async () =>
      readClaudeFolderLoginAsync(await claudeStateFileAsync(process.env.CLAUDE_CONFIG_DIR)),
    listEnvironments: () => listEnvironments(getAppEnvironment().getPath('userData')),
    callEnvironment: (environmentId, method, params, timeoutMs) =>
      ctx.runtime.callOrchestrationWorkerServer(environmentId, method, params, timeoutMs)
  }
}

export const FORK_POOLED_LIMITS_METHODS = [
  defineMethod({
    name: 'fork.limits.machineUsage',
    permission: 'workspace',
    params: ForkMachineUsageParams,
    handler: (params, ctx): Promise<ForkMachineUsageResult> =>
      readForkMachineUsage(deps(ctx), params)
  }),
  defineMethod({
    name: 'fork.limits.usage',
    permission: 'workspace',
    params: ForkPooledLimitsParams,
    handler: (params, ctx): Promise<ForkPooledLimitsResult> =>
      readForkPooledLimits(deps(ctx), params)
  })
] as const
