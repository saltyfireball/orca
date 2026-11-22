// Command guards (FORK.md, BAD-686): `orca command-guards`. The audit list of blocked commands,
// the rules and which agents are guarded, and a per-project (or host-wide) allow for one rule.
// No call carries a command to run.
import { defineMethod } from '../../core'
import {
  ForkCommandGuardsAllowParams,
  ForkCommandGuardsListParams,
  ForkCommandGuardsStatusParams
} from '../../../../../shared/fork/command-guards-wire'
import {
  forkCommandGuardList,
  forkCommandGuardSetAllow,
  forkCommandGuardStatus
} from '../../../../fork/command-guards/command-guards-live'

export const FORK_COMMAND_GUARDS_METHODS = [
  defineMethod({
    name: 'fork.commandGuards.list',
    permission: 'workspace',
    params: ForkCommandGuardsListParams,
    handler: async () => forkCommandGuardList()
  }),
  defineMethod({
    name: 'fork.commandGuards.status',
    permission: 'workspace',
    params: ForkCommandGuardsStatusParams,
    handler: async () => forkCommandGuardStatus()
  }),
  defineMethod({
    name: 'fork.commandGuards.allow',
    permission: 'workspace',
    params: ForkCommandGuardsAllowParams,
    handler: async (params) => forkCommandGuardSetAllow(params.rule, params.project, params.allowed)
  })
] as const
