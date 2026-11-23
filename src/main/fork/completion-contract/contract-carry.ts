// Completion contract carry-over (BAD-763, FORK.md): a Task's done checks and review request travel
// with the work. A retry, a follow-up and a `--retry-of` start copy them to the Task they create,
// and a start on a paired server sends them to it so that server gates the worker's done.
// Everything here reads and writes the fork-owned contract tables only.
import { forkDoneContractOf } from '../../../shared/fork/completion-contract'
import { forkReviewGateOf, type ForkReviewGate } from '../../../shared/fork/reviewer-gate'
import { readReviewGate, saveReviewGate } from '../reviewer-gate/reviewer-store'
import { readContract, saveContract, type ContractDbHandle } from './contract-store'

/** The request fields a start carries: the same names `worker-start` takes, so one reader serves both. */
export type ForkContractWire = {
  forkDoneChecks?: string[]
  forkRequirePrChecks?: boolean
  forkDoneMaxRounds?: number
  forkReview?: boolean
  forkReviewFocus?: ForkReviewGate['focus']
  forkReviewAgent?: NonNullable<ForkReviewGate['agent']>
  forkReviewMaxRounds?: number
}

type TaskLookup = ContractDbHandle & {
  getDispatchContextById: (id: string) => { task_id: string } | undefined | null
}

/** What a Task declares, as request fields; null when it declares neither checks nor a review. */
export function forkTaskContractWire(
  db: ContractDbHandle,
  taskId: string
): ForkContractWire | null {
  const state = readContract(db, taskId)
  const review = readReviewGate(db, taskId)
  if (!state && !review) {
    return null
  }
  const wire: ForkContractWire = {}
  if (state) {
    const { checks, requirePrChecks, maxRounds } = state.contract
    if (checks.length > 0) {
      wire.forkDoneChecks = checks
    }
    if (requirePrChecks) {
      wire.forkRequirePrChecks = true
    }
    if (maxRounds !== null) {
      wire.forkDoneMaxRounds = maxRounds
    }
  }
  if (review) {
    wire.forkReview = true
    wire.forkReviewFocus = review.gate.focus
    if (review.gate.agent) {
      wire.forkReviewAgent = review.gate.agent
    }
    if (review.gate.maxRounds !== null) {
      wire.forkReviewMaxRounds = review.gate.maxRounds
    }
  }
  return wire
}

/** The Task a Dispatch belongs to, on this database. */
function taskOfDispatch(db: TaskLookup, dispatchId: string | undefined): string | null {
  return dispatchId ? (db.getDispatchContextById(dispatchId)?.task_id ?? null) : null
}

/**
 * Copies the contract and the review request of the Task `fromDispatchId` belonged to onto
 * `toTaskId`, each only when the new Task declares none of its own. Rounds start at zero.
 */
export function forkCarryContract(
  db: TaskLookup,
  toTaskId: string,
  fromDispatchId: string | undefined
): void {
  const fromTaskId = taskOfDispatch(db, fromDispatchId)
  if (!fromTaskId || fromTaskId === toTaskId) {
    return
  }
  if (!readContract(db, toTaskId)) {
    const state = readContract(db, fromTaskId)
    if (state) {
      saveContract(db, toTaskId, state.contract)
    }
  }
  if (!readReviewGate(db, toTaskId)) {
    const review = readReviewGate(db, fromTaskId)
    if (review) {
      saveReviewGate(db, toTaskId, review.gate)
    }
  }
}

/**
 * True when a start on a paired server has a contract or review to hand over: declared in its own
 * request, already on the Task (task-create), or inherited from the Dispatch it continues. Read
 * only, so it can run before anything is created.
 */
export function forkStartCarriesContract(
  db: TaskLookup,
  request: { params: unknown; taskId?: string; continuesDispatchId?: string }
): boolean {
  if (forkDoneContractOf(request.params) || forkReviewGateOf(request.params)) {
    return true
  }
  const sources = [request.taskId, taskOfDispatch(db, request.continuesDispatchId)]
  return sources.some((taskId) => taskId && forkTaskContractWire(db, taskId) !== null)
}
