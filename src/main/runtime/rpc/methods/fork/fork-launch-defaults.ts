// Fork launch defaults (FORK.md "Launch defaults"): `orca launch-defaults` reads what each kind of
// launch runs per agent on this host. Read-only.
import { defineMethod } from '../../core'
import type { AgentLaunchChoices } from '../../../../../shared/agent-launch/choices/agent-launch-choices'
import { buildForkLaunchDefaultsReport } from '../../../../../shared/fork/launch-defaults/launch-defaults-report'

export const FORK_LAUNCH_DEFAULTS_METHODS = [
  defineMethod({
    name: 'fork.launchDefaults.show',
    permission: 'workspace',
    params: null,
    handler: async (_params, { runtime }) => {
      const settings = runtime.requireStore().getSettings() as {
        forkLaunchDefaults?: unknown
        agentLaunchChoices?: AgentLaunchChoices
      }
      return buildForkLaunchDefaultsReport(settings)
    }
  })
] as const
