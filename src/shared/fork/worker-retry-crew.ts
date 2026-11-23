// Worker retry policy (BAD-681, FORK.md): what a crew row shows about a worker's automatic retry.
// The worker that ended says whether Orca waits to restart it, restarted it or gave up; the worker
// a restart started says which retry it is. Optional on the row, so older hosts and clients skip it.
import * as z from 'zod'

export const ForkCrewRetry = z.object({
  attempt: z.number(),
  /** Why the worker ended, in the words the coordinator read. */
  reason: z.string(),
  state: z.enum(['waiting', 'restarted', 'gave-up']),
  /** `ended`: this row is the worker that ended; `restart`: the worker the retry started. */
  side: z.enum(['ended', 'restart']),
  /** When a waiting restart is due (ISO). */
  dueAt: z.string().optional(),
  /** Why Orca gave up. */
  detail: z.string().optional()
})

export type ForkCrewRetryState = z.infer<typeof ForkCrewRetry>
