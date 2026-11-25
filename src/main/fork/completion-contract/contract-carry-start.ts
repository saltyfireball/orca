// Completion contract carry-over (BAD-763): the two steps of a start on a paired server. Before
// anything is created, a server that cannot take the Task's done checks and review is refused (it
// would settle the worker's done unchecked). After the Dispatch exists, the contract is kept on
// the home (for `orca contract show`) and returned as the request fields to send along.
import { OrchestrationError } from '../../runtime/orchestration/orchestration-error'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { FederatedWorkerStartRequest } from '../../runtime/orchestration/legacy-remote-home/federated-worker-start-request'
import { ORCHESTRATION_FORK_CONTRACT_CARRY_RUNTIME_CAPABILITY } from '../../../shared/orchestration/orchestration-runtime-capabilities'
import { effectiveReviewGate, type ForkReviewGate } from '../../../shared/fork/reviewer-gate'
import { forkStoreDoneContract } from './completion-gate-live'
import {
  forkStartCarriesContract,
  forkTaskContractWire,
  type ForkContractWire
} from './contract-carry'
import { forkReviewerGateSettings } from '../reviewer-gate/reviewer-gate-live'
import { saveReviewGate } from '../reviewer-gate/reviewer-store'
import {
  forkAgentProfileServerCarry,
  type ForkAgentProfileCarry
} from '../agent-profiles/agent-profile-remote-carry'

/** BAD-820: the review forkReviewerGateAllTasks asks of every Task here, with this host's rounds; null when off. */
function allTasksReview(runtime: OrcaRuntimeService | undefined): ForkReviewGate | null {
  if (!runtime) {
    return null
  }
  const settings = forkReviewerGateSettings(runtime)
  const gate = effectiveReviewGate(null, settings)
  return gate && { ...gate, maxRounds: settings.maxRounds }
}

/**
 * The Task's wire, with the all-Tasks review added when it carries none of its own. That review is
 * stored on the Task as its own request, so a retry sends it again after the setting is turned off.
 */
function withAllTasksReview(
  runtime: OrcaRuntimeService | undefined,
  db: OrchestrationDb,
  taskId: string
): ForkContractWire | null {
  const wire = forkTaskContractWire(db, taskId)
  const gate = wire?.forkReview ? null : allTasksReview(runtime)
  if (!gate) {
    return wire
  }
  saveReviewGate(db, taskId, gate)
  return forkTaskContractWire(db, taskId)
}

/** Why a start would carry a contract or review to the server, or null when it carries neither. */
function carryReason(
  runtime: OrcaRuntimeService | undefined,
  db: OrchestrationDb,
  params: { retryOf?: string | undefined },
  taskId: string | undefined
): 'task' | 'all-tasks' | null {
  if (forkStartCarriesContract(db, { params, taskId, continuesDispatchId: params.retryOf })) {
    return 'task'
  }
  return allTasksReview(runtime) ? 'all-tasks' : null
}

type FederatedCarry = (taskId: string) => (ForkContractWire & ForkAgentProfileCarry) | null

/** The attach-start's carry, with the home's all-Tasks review (BAD-820). */
export function forkFederatedStartCarry(
  start: Pick<FederatedWorkerStartRequest, 'runtime' | 'db' | 'params' | 'task'>,
  serverName: string,
  capabilities: readonly string[] | undefined
): FederatedCarry {
  const { runtime, db, params, task } = start
  return forkFederatedCarry(db, params, task?.id, serverName, capabilities, runtime)
}

/** `home` gives this host's reviewer settings; without it the all-Tasks review is not sent. */
export function forkFederatedCarry(
  db: OrchestrationDb,
  params: { retryOf?: string | undefined },
  taskId: string | undefined,
  serverName: string,
  capabilities: readonly string[] | undefined,
  home?: OrcaRuntimeService
): FederatedCarry {
  // BAD-741: a --profile start's permission mode, account and preamble ride the same attach-start.
  const profile = forkAgentProfileServerCarry(serverName, capabilities)
  if (!capabilities?.includes(ORCHESTRATION_FORK_CONTRACT_CARRY_RUNTIME_CAPABILITY)) {
    const reason = carryReason(home, db, params, taskId)
    if (reason) {
      throw contractCarryRefused(serverName, reason)
    }
  }
  return (taskForRemote) => {
    forkStoreDoneContract(db, taskForRemote, params)
    const contract = withAllTasksReview(home, db, taskForRemote)
    return contract || profile.forkAgentProfileLaunch ? { ...contract, ...profile } : null
  }
}

function contractCarryRefused(
  serverName: string,
  reason: 'task' | 'all-tasks'
): OrchestrationError {
  return new OrchestrationError(
    'capability_unsupported',
    reason === 'task'
      ? `Connected server ${serverName} cannot check this Task's done checks or review before its worker settles (it needs the same Blackfish version as this computer). Update it or start the worker here. No effects were applied.`
      : `Connected server ${serverName} cannot review this Task before its worker settles, and forkReviewerGateAllTasks is on here, so every Task must be reviewed (the server needs the same Blackfish version as this computer). Update it, start the worker here, or turn the setting off with \`orca settings set forkReviewerGateAllTasks false\` to start it there unreviewed. No effects were applied.`,
    { effectsApplied: false }
  )
}

/**
 * BAD-798: the same refusal for a server that owns its workers, before anything is created. Its
 * capability is asked only when the start or its Task has a contract or review to hand over.
 */
export async function forkRemoteOwnedContractPreflight(
  runtime: OrcaRuntimeService,
  db: OrchestrationDb,
  params: { retryOf?: string | undefined },
  taskId: string | undefined,
  serverName: string,
  serverCarries: (capability: string) => Promise<boolean>
): Promise<void> {
  const reason = carryReason(runtime, db, params, taskId)
  if (reason && !(await serverCarries(ORCHESTRATION_FORK_CONTRACT_CARRY_RUNTIME_CAPABILITY))) {
    throw contractCarryRefused(serverName, reason)
  }
}

/**
 * BAD-798: what a start on a server that owns its workers sends of the Task's contract. The start's
 * own flags are saved over the Task's first (each of checks and review on its own), so the wire is
 * the Task's stored contract with the start's flags winning, as a local `worker-start --task` does.
 */
export function forkRemoteOwnedContractWire(
  runtime: OrcaRuntimeService,
  db: OrchestrationDb,
  taskId: string,
  params: unknown
): ForkContractWire {
  forkStoreDoneContract(db, taskId, params)
  return withAllTasksReview(runtime, db, taskId) ?? {}
}
