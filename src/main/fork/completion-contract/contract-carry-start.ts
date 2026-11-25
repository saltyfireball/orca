// Completion contract carry-over (BAD-763): the two steps of a start on a paired server. Before
// anything is created, a server that cannot take the Task's done checks and review is refused (it
// would settle the worker's done unchecked). After the Dispatch exists, the contract is kept on
// the home (for `orca contract show`) and returned as the request fields to send along.
import { OrchestrationError } from '../../runtime/orchestration/orchestration-error'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { ORCHESTRATION_FORK_CONTRACT_CARRY_RUNTIME_CAPABILITY } from '../../../shared/orchestration/orchestration-runtime-capabilities'
import { forkStoreDoneContract } from './completion-gate-live'
import {
  forkStartCarriesContract,
  forkTaskContractWire,
  type ForkContractWire
} from './contract-carry'
import {
  forkAgentProfileServerCarry,
  type ForkAgentProfileCarry
} from '../agent-profiles/agent-profile-remote-carry'

export function forkFederatedCarry(
  db: OrchestrationDb,
  params: { retryOf?: string | undefined },
  taskId: string | undefined,
  serverName: string,
  capabilities: readonly string[] | undefined
): (taskId: string) => (ForkContractWire & ForkAgentProfileCarry) | null {
  // BAD-741: a --profile start's permission mode, account and preamble ride the same attach-start.
  const profile = forkAgentProfileServerCarry(serverName, capabilities)
  if (
    !capabilities?.includes(ORCHESTRATION_FORK_CONTRACT_CARRY_RUNTIME_CAPABILITY) &&
    forkStartCarriesContract(db, { params, taskId, continuesDispatchId: params.retryOf })
  ) {
    throw contractCarryRefused(serverName)
  }
  return (taskForRemote) => {
    forkStoreDoneContract(db, taskForRemote, params)
    const contract = forkTaskContractWire(db, taskForRemote)
    return contract || profile.forkAgentProfileLaunch ? { ...contract, ...profile } : null
  }
}

function contractCarryRefused(serverName: string): OrchestrationError {
  return new OrchestrationError(
    'capability_unsupported',
    `Connected server ${serverName} cannot check this Task's done checks or review before its worker settles (it needs the same Blackfish version as this computer). Update it or start the worker here. No effects were applied.`,
    { effectsApplied: false }
  )
}

/**
 * BAD-798: the same refusal for a server that owns its workers, before anything is created. Its
 * capability is asked only when the start or its Task has a contract or review to hand over.
 */
export async function forkRemoteOwnedContractPreflight(
  db: OrchestrationDb,
  params: { retryOf?: string | undefined },
  taskId: string | undefined,
  serverName: string,
  serverCarries: (capability: string) => Promise<boolean>
): Promise<void> {
  if (
    forkStartCarriesContract(db, { params, taskId, continuesDispatchId: params.retryOf }) &&
    !(await serverCarries(ORCHESTRATION_FORK_CONTRACT_CARRY_RUNTIME_CAPABILITY))
  ) {
    throw contractCarryRefused(serverName)
  }
}

/**
 * BAD-798: what a start on a server that owns its workers sends of the Task's contract. The start's
 * own flags are saved over the Task's first (each of checks and review on its own), so the wire is
 * the Task's stored contract with the start's flags winning, as a local `worker-start --task` does.
 */
export function forkRemoteOwnedContractWire(
  db: OrchestrationDb,
  taskId: string,
  params: unknown
): ForkContractWire {
  forkStoreDoneContract(db, taskId, params)
  return forkTaskContractWire(db, taskId) ?? {}
}
