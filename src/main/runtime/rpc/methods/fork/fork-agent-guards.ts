// Agent guards (FORK.md, SLRM-2385): `orca guards`. List the agents a guard warned or paused and
// the agents with a spend cap on this host, lift a pause, or set a chat, a Run or an automation
// its own cap (BAD-679). No call
// carries text to send to an agent.
import { defineMethod } from '../../core'
import { FORK_COMMAND_GUARDS_METHODS } from './fork-command-guards'
import {
  ForkGuardsAutomationCapParams,
  ForkGuardsCapParams,
  ForkGuardsListParams,
  ForkGuardsTargetParams,
  type ForkGuardsAutomationCapResult,
  type ForkGuardsCapResult,
  type ForkGuardsListResult,
  type ForkGuardsResumeResult
} from '../../../../../shared/fork/agent-guards-wire'
import {
  forkAgentGuardList,
  forkAgentGuardResume,
  forkAgentGuardSetAutomationCap,
  forkAgentGuardSetCap
} from '../../../../fork/agent-guards/agent-guards-service'

// BAD-686: the command guards' methods ride along, so rpc-method-registry.ts is untouched.
export const FORK_AGENT_GUARDS_METHODS = [
  ...FORK_COMMAND_GUARDS_METHODS,
  defineMethod({
    name: 'fork.guards.list',
    permission: 'workspace',
    params: ForkGuardsListParams,
    handler: async (): Promise<ForkGuardsListResult> => forkAgentGuardList()
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
    handler: (params): Promise<ForkGuardsCapResult> =>
      forkAgentGuardSetCap(params.id, params.usd, params.run === true)
  }),
  defineMethod({
    name: 'fork.guards.automationCap',
    permission: 'workspace',
    params: ForkGuardsAutomationCapParams,
    handler: (params): Promise<ForkGuardsAutomationCapResult> =>
      forkAgentGuardSetAutomationCap(params.id, {
        runUsd: params.run,
        dayUsd: params.day,
        weekUsd: params.week
      })
  })
] as const
