// Worker retry policy (BAD-681, FORK.md "Worker retry policy"): when a worker exits, is lost or
// stops on a provider error, Orca can start it again in the same workspace after a backoff instead
// of waiting for the coordinator. Pure parts shared by the host, the CLI and the tests.
import { z } from 'zod'
import type { TerminalExitCause } from '../terminal/pty/lifecycle/terminal-exit-cause'

export type ForkWorkerRetrySettings = {
  /** Fork worker retry (BAD-681): restart a worker that exited, was lost or hit a provider error, in its workspace after a backoff, instead of waiting for the coordinator. A Run's own policy (`orca retry policy --run`) overrides it. Off unless true. */
  forkWorkerRetry?: boolean
  /** Fork worker retry: restarts of one Task before it goes to the coordinator (0 to 10); unset is 2. */
  forkWorkerRetryMax?: number
  /** Fork worker retry: seconds before the first restart; each later one waits twice as long (1 to 3600); unset is 30. */
  forkWorkerRetryBackoffSeconds?: number
  /** Fork worker retry: longest wait between restarts, in seconds (1 to 86400); unset is 300. */
  forkWorkerRetryMaxBackoffSeconds?: number
}

export const WORKER_RETRY_DEFAULT_MAX = 2
export const WORKER_RETRY_MAX_LIMIT = 10
export const WORKER_RETRY_DEFAULT_BACKOFF_SECONDS = 30
export const WORKER_RETRY_DEFAULT_MAX_BACKOFF_SECONDS = 300

/** A Run's own policy; a null field takes the setting. */
export type WorkerRetryRunPolicy = {
  enabled: boolean | null
  max: number | null
  backoffSeconds: number | null
}

export type WorkerRetryPolicy = {
  enabled: boolean
  max: number
  backoffMs: number
  maxBackoffMs: number
}

function whole(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.trunc(value)))
    : fallback
}

/** The policy a Run gets: its own choices over the settings over the defaults. */
export function resolveWorkerRetryPolicy(
  settings: ForkWorkerRetrySettings | null | undefined,
  run: WorkerRetryRunPolicy | null | undefined
): WorkerRetryPolicy {
  const s = settings ?? {}
  const max = whole(
    run?.max ?? s.forkWorkerRetryMax,
    0,
    WORKER_RETRY_MAX_LIMIT,
    WORKER_RETRY_DEFAULT_MAX
  )
  const backoff = whole(
    run?.backoffSeconds ?? s.forkWorkerRetryBackoffSeconds,
    1,
    3600,
    WORKER_RETRY_DEFAULT_BACKOFF_SECONDS
  )
  const cap = whole(
    s.forkWorkerRetryMaxBackoffSeconds,
    1,
    86_400,
    WORKER_RETRY_DEFAULT_MAX_BACKOFF_SECONDS
  )
  return {
    enabled: (run?.enabled ?? s.forkWorkerRetry === true) && max > 0,
    max,
    backoffMs: backoff * 1000,
    maxBackoffMs: Math.max(backoff, cap) * 1000
  }
}

/** Exponential: the first retry waits the base, then double, up to the cap. `attempt` counts from 1. */
export function workerRetryDelayMs(attempt: number, policy: WorkerRetryPolicy): number {
  const doublings = Math.min(Math.max(0, attempt - 1), 30)
  return Math.min(policy.maxBackoffMs, policy.backoffMs * 2 ** doublings)
}

/** Typed provider failures that a later attempt can get past. A limit, a bad login or a refused
 *  request would fail the same way, so they stay with the coordinator. */
export const WORKER_RETRY_TRANSIENT_FAILURE_KINDS: ReadonlySet<string> = new Set([
  'providerUnavailable',
  'providerResponseFailed',
  'providerExited',
  'restartFailed'
])

/** How a worker went away, read from the structured exit and never from the free text of a stop
 *  report. The terminal kinds come from `TerminalExitCause`; the rest name the other producers of
 *  an `exited` or `lost` stop. */
export type WorkerExitKind =
  | 'operator_close'
  | 'signaled'
  | 'process_exited'
  | 'host_lost'
  | 'host_status_unavailable'
  | 'cause_unreported'
  | 'stop_unverified'
  | 'agent_exited'
  | 'agent_lost'
  | 'terminal_missing'
  | 'provider_death'
  | 'start_failed'
  | 'app_update'
  | 'app_crash'
  | 'app_quit'
  | 'restart_dismissed'
  | 'maybe_running'

/** The exit kind a terminal's exit cause stands for. */
export function workerExitKindOfTerminalCause(cause: TerminalExitCause): WorkerExitKind {
  switch (cause.kind) {
    case 'operator_close':
      return 'operator_close'
    case 'signaled':
      return 'signaled'
    case 'exited':
      return 'process_exited'
    case 'unknown':
      return cause.reason
  }
}

/** Exits the user or the app chose: nothing to heal. */
const DELIBERATE_EXITS: ReadonlySet<WorkerExitKind> = new Set([
  'operator_close',
  'app_quit',
  'restart_dismissed'
])

/** Exits that may have left the agent running: a restart could start a second one beside it. */
const MAY_STILL_RUN_EXITS: ReadonlySet<WorkerExitKind> = new Set([
  'stop_unverified',
  'maybe_running'
])

export type WorkerRetryStop = {
  /** The stop reasons upstream reports; 'start-blocked', 'never-ready' and 'background-wait' (added by
   *  upstream in 1.4.272) are never a failure to heal, so they hold as `not-a-failure`. */
  reason:
    | 'finished'
    | 'errored'
    | 'needs-input'
    | 'exited'
    | 'lost'
    | 'start-unconfirmed'
    | 'start-blocked'
    | 'never-ready'
    | 'start-failed'
    | 'background-wait'
  /** Why a worker went away, for an exit, in words for the coordinator. Never matched on. */
  cause?: string | undefined
  /** How it went away, structured: what the retry decision reads. Absent reads as a plain exit. */
  exitKind?: WorkerExitKind | undefined
  /** The typed failure kind of a chat request that failed, for an `errored` stop. */
  requestErrorKind?: string | undefined
  neverStarted?: boolean | undefined
  /** How its going away settled the Dispatch; the start breaker has its own count. */
  settled?: 'failed' | 'circuit_broken' | undefined
}

export type WorkerRetryInput = {
  policy: WorkerRetryPolicy
  stop: WorkerRetryStop
  /** Restarts this Task has already had. */
  attemptsUsed: number
  /** The worker sent its own worker_done (succeeded or failed): its report is final. */
  workerReported: boolean
  taskStatus: string | null
  /** Why a restart could not start even if the policy allows it (no worker to resume, no
   *  coordinator to start it as): the coordinator is then not told Orca is retrying. */
  blocked?: 'cannot-resume' | 'no-coordinator' | null
}

export type WorkerRetryDecision =
  | { retry: true; attempt: number; delayMs: number; reason: string }
  | { retry: false; why: WorkerRetryHold }

export type WorkerRetryHold =
  | 'off'
  | 'worker-reported'
  | 'task-settled'
  | 'not-a-failure'
  | 'deliberate'
  | 'may-still-run'
  | 'never-started'
  | 'not-transient'
  | 'exhausted'
  | 'cannot-resume'
  | 'no-coordinator'

/** Why a retry was not started, in words for the coordinator and `orca retry show`. */
export const WORKER_RETRY_HOLD_TEXT: Record<WorkerRetryHold, string> = {
  off: 'retries were switched off',
  'worker-reported': 'the worker reported',
  'task-settled': 'the Task is settled',
  'not-a-failure': 'the worker had not failed',
  deliberate: 'the worker was closed on purpose',
  'may-still-run': 'the agent may still be running',
  'never-started': 'the worker never started',
  'not-transient': 'the error is not one a retry fixes',
  exhausted: 'the limit was reached',
  'cannot-resume': 'this worker cannot be resumed',
  'no-coordinator': 'its Run has no coordinator to start it as'
}

/** Why a stop is worth another attempt, in the words the coordinator reads. */
export function workerRetryReason(stop: WorkerRetryStop): string {
  if (stop.reason === 'errored') {
    return `provider error${stop.requestErrorKind ? ` (${stop.requestErrorKind})` : ''}`
  }
  const cause = stop.cause ? ` (${stop.cause.slice(0, 120)})` : ''
  if (stop.reason === 'start-failed') {
    return `worker did not start${cause}`
  }
  return stop.reason === 'lost' ? `worker lost${cause}` : `worker exited${cause}`
}

/** The decision table. A worker that reported (done or failed on purpose) is never retried. */
export function decideWorkerRetry(input: WorkerRetryInput): WorkerRetryDecision {
  const { policy, stop } = input
  const hold = (why: WorkerRetryHold): WorkerRetryDecision => ({
    retry: false,
    why
  })
  if (!policy.enabled) {
    return hold('off')
  }
  if (input.workerReported) {
    return hold('worker-reported')
  }
  if (input.taskStatus === 'completed' || input.taskStatus === 'failed') {
    return hold('task-settled')
  }
  if (
    stop.reason !== 'exited' &&
    stop.reason !== 'lost' &&
    stop.reason !== 'errored' &&
    stop.reason !== 'start-failed'
  ) {
    return hold('not-a-failure')
  }
  if (stop.neverStarted || stop.settled === 'circuit_broken') {
    return hold('never-started')
  }
  if (stop.reason === 'errored') {
    if (
      !stop.requestErrorKind ||
      !WORKER_RETRY_TRANSIENT_FAILURE_KINDS.has(stop.requestErrorKind)
    ) {
      return hold('not-transient')
    }
  } else if (stop.exitKind && DELIBERATE_EXITS.has(stop.exitKind)) {
    return hold('deliberate')
  } else if (stop.exitKind && MAY_STILL_RUN_EXITS.has(stop.exitKind)) {
    return hold('may-still-run')
  }
  if (input.attemptsUsed >= policy.max) {
    return hold('exhausted')
  }
  if (input.blocked) {
    return hold(input.blocked)
  }
  const attempt = input.attemptsUsed + 1
  return {
    retry: true,
    attempt,
    delayMs: workerRetryDelayMs(attempt, policy),
    reason: workerRetryReason(stop)
  }
}

// RPC and digest shapes.

export const ForkWorkerRetryPolicyParams = z.object({
  run: z.string().trim().min(1).max(256).optional(),
  /** Absent leaves the Run's choice as it is; false switches retries off for the Run. */
  enabled: z.boolean().optional(),
  max: z.number().int().min(0).max(WORKER_RETRY_MAX_LIMIT).optional(),
  backoffSeconds: z.number().int().min(1).max(3600).optional(),
  /** Drop the Run's own policy and take the settings again. */
  clear: z.boolean().optional()
})

export const ForkWorkerRetryShowParams = z.object({
  task: z.string().trim().min(1).max(256).optional(),
  run: z.string().trim().min(1).max(256).optional()
})

export type ForkWorkerRetryEntry = {
  taskId: string
  runId: string | null
  /** The Dispatch that ended. */
  dispatchId: string
  /** The Dispatch the restart started, once it has. */
  retryDispatchId: string | null
  attempt: number
  reason: string
  at: string
  dueAt: string
  status: 'scheduled' | 'started' | 'failed' | 'cancelled' | 'skipped'
  detail: string | null
}

export type ForkWorkerRetryShowResult = {
  policy: WorkerRetryPolicy & {
    run: string | null
    own: WorkerRetryRunPolicy | null
  }
  retries: ForkWorkerRetryEntry[]
}

export type ForkDigestRetry = {
  taskId: string
  title: string
  attempt: number
  reason: string
  status: ForkWorkerRetryEntry['status']
  at: number
}
