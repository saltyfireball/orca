// Set up on a server (FORK.md, SLRM-2312): fork.serverSetup.plan and .readiness answer for this
// machine as the server a project is being set up on; fork.serverSetup.run sets a project up on
// one of this machine's paired servers, for the CLI.
import { defineMethod, type RpcContext } from '../../core'
import { getAppEnvironment } from '../../../../../shared/app-lifecycle/app-environment'
import { listEnvironments } from '../../../../../shared/remote-runtime/host-store/runtime-environment-store'
import {
  FORK_SERVER_SETUP_PLAN_METHOD,
  FORK_SERVER_SETUP_READINESS_METHOD,
  FORK_SERVER_SETUP_RUN_METHOD,
  ForkServerSetupPlanParams,
  ForkServerSetupReadinessParams,
  ForkServerSetupRunParams,
  type ForkServerSetupPlan,
  type ForkServerSetupReadinessResult,
  type ForkServerSetupRunResult
} from '../../../../../shared/fork/server-setup-wire'
import type { ForkServerSetupSettings } from '../../../../../shared/fork/server-setup'
import { runEnvironmentDoctor } from '../../../../environment-doctor/environment-doctor'
import { createHostEnvironmentDoctorDeps } from '../../../../environment-doctor/environment-doctor-host'
import {
  createForkServerSetupHostDeps,
  planForkServerSetup,
  readForkServerSetupReadiness
} from '../../../../fork/server-setup/server-setup-host'
import { runForkServerSetupOnEnvironment } from '../../../../fork/server-setup/server-setup-run'

function hostDeps() {
  const doctor = createHostEnvironmentDoctorDeps({ refreshShellPath: true })
  return createForkServerSetupHostDeps({
    runDoctor: (path) => runEnvironmentDoctor({ worktreePath: path }, doctor),
    findCommands: (commands) => doctor.findCommands(commands)
  })
}

function settings(ctx: RpcContext): ForkServerSetupSettings | null {
  try {
    return ctx.runtime.requireStore().getSettings() as ForkServerSetupSettings
  } catch {
    // A host without a settings store uses the defaults.
    return null
  }
}

export const FORK_SERVER_SETUP_METHODS = [
  defineMethod({
    name: FORK_SERVER_SETUP_PLAN_METHOD,
    permission: 'workspace',
    params: ForkServerSetupPlanParams,
    handler: async (params): Promise<ForkServerSetupPlan> => planForkServerSetup(params, hostDeps())
  }),
  defineMethod({
    name: FORK_SERVER_SETUP_READINESS_METHOD,
    permission: 'workspace',
    params: ForkServerSetupReadinessParams,
    handler: async (params): Promise<ForkServerSetupReadinessResult> =>
      readForkServerSetupReadiness(params.path, hostDeps())
  }),
  defineMethod({
    name: FORK_SERVER_SETUP_RUN_METHOD,
    permission: 'workspace',
    params: ForkServerSetupRunParams,
    handler: async (params, ctx): Promise<ForkServerSetupRunResult> =>
      runForkServerSetupOnEnvironment(
        {
          settings: () => settings(ctx),
          listEnvironments: () => listEnvironments(getAppEnvironment().getPath('userData')),
          listProjects: () => ctx.runtime.listProjects(),
          listRepos: () => ctx.runtime.listRepos(),
          callEnvironment: (environmentId, method, callParams, timeoutMs) =>
            ctx.runtime.callOrchestrationWorkerServer(environmentId, method, callParams, timeoutMs)
        },
        params
      )
  })
] as const
