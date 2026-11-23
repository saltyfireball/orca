// FORK.md "Agent profiles": the host's profile catalog and `--profile` resolution. Each host
// answers from its own settings, so a paired server applies its own installed agents and policy.
import { defineMethod, InvalidArgumentError } from '../../core'
import {
  ForkAgentProfileResolveParams,
  ForkAgentProfilesListParams
} from '../../../../../shared/fork/agent-profiles/agent-profiles-wire'
import {
  forkAgentProfileLaunchSummary,
  forkAgentProfileListRows,
  forkAgentProfileResolve
} from '../../../../fork/agent-profiles/agent-profiles-service'

export const FORK_AGENT_PROFILE_METHODS = [
  defineMethod({
    name: 'fork.agentProfiles.list',
    permission: 'workspace',
    params: ForkAgentProfilesListParams,
    handler: async (_params, { runtime }) => ({
      profiles: forkAgentProfileListRows(runtime.requireStore().getSettings())
    })
  }),
  defineMethod({
    name: 'fork.agentProfiles.resolve',
    permission: 'workspace',
    params: ForkAgentProfileResolveParams,
    handler: async (params, { runtime }) => {
      const { name, ...explicit } = params
      const resolution = forkAgentProfileResolve(
        runtime.requireStore().getSettings(),
        name,
        explicit
      )
      if (!resolution.ok) {
        throw new InvalidArgumentError(resolution.message)
      }
      const launch = forkAgentProfileLaunchSummary(
        runtime.requireStore().getSettings(),
        resolution.resolved,
        params.remote === true
      )
      if (!launch.ok) {
        throw new InvalidArgumentError(launch.message)
      }
      return { resolved: resolution.resolved, launch: launch.summary }
    }
  })
] as const
