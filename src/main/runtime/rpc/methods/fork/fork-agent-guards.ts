// Agent guards (FORK.md, SLRM-2385): `orca guards`. List the agents a guard warned or paused and
// the chats with a spend cap on this host, lift a pause, or set one chat its own cap. No call
// carries text to send to an agent.
import { defineMethod } from '../../core'
import {
  ForkGuardsCapParams,
  ForkGuardsListParams,
  ForkGuardsTargetParams,
  type ForkGuardsCapResult,
  type ForkGuardsListResult,
  type ForkGuardsResumeResult
} from '../../../../../shared/fork/agent-guards-wire'
import {
  forkAgentGuardEntries,
  forkAgentGuardResume,
  forkAgentGuardSetCap
} from '../../../../fork/agent-guards/agent-guards-service'

export const FORK_AGENT_GUARDS_METHODS = [
  defineMethod({
    name: 'fork.guards.list',
    permission: 'workspace',
    params: ForkGuardsListParams,
    handler: async (): Promise<ForkGuardsListResult> => ({
      now: Date.now(),
      entries: forkAgentGuardEntries()
    })
  }),
  defineMethod({
    name: 'fork.guards.resume',
    permission: 'workspace',
    params: ForkGuardsTargetParams,
    handler: (params): Promise<ForkGuardsResumeResult> => forkAgentGuardResume(params.id)
  }),
  defineMethod({
    name: 'fork.guards.cap',
    permission: 'workspace',
    params: ForkGuardsCapParams,
    handler: (params): Promise<ForkGuardsCapResult> => forkAgentGuardSetCap(params.id, params.usd)
  })
] as const
