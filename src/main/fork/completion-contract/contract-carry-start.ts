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

export function forkFederatedCarry(
  db: OrchestrationDb,
  params: { retryOf?: string | undefined },
  taskId: string | undefined,
  serverName: string,
  capabilities: readonly string[] | undefined
): (taskId: string) => ForkContractWire | null {
  if (
    !capabilities?.includes(ORCHESTRATION_FORK_CONTRACT_CARRY_RUNTIME_CAPABILITY) &&
    forkStartCarriesContract(db, { params, taskId, continuesDispatchId: params.retryOf })
  ) {
    throw new OrchestrationError(
      'capability_unsupported',
      `Connected server ${serverName} cannot check this Task's done checks or review before its worker settles (it needs the same Blackfish version as this computer). Update it or start the worker here. No effects were applied.`,
      { effectsApplied: false }
    )
  }
  return (taskForRemote) => {
    forkStoreDoneContract(db, taskForRemote, params)
    return forkTaskContractWire(db, taskForRemote)
  }
}
