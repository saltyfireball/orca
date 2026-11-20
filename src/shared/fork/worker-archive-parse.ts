// Worker archive (FORK.md, BAD-669): reads a paired server's cleanup answer. A server on another
// build may answer in another shape; anything that does not read as a result is dropped.
import { z } from 'zod'
import type { ForkWorkerCleanupResult } from './worker-archive'

const Row = z.object({
  worktreeId: z.string(),
  name: z.string(),
  branch: z.string().nullable(),
  path: z.string(),
  botName: z.string().nullable(),
  finishedAtMs: z.number(),
  outcome: z.enum(['remove', 'skip', 'failed']),
  reason: z.string().optional(),
  dirtyFiles: z.number().nullable().optional(),
  unlandedCommits: z.number().nullable().optional(),
  canForce: z.boolean(),
  server: z.string().optional(),
  error: z.string().optional()
})

const Result = z.object({
  dryRun: z.boolean(),
  enabled: z.boolean(),
  rows: z.array(Row)
})

export function parseForkWorkerCleanupResult(value: unknown): ForkWorkerCleanupResult | null {
  const parsed = Result.safeParse(value)
  if (!parsed.success) {
    return null
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a reason string from another build only reaches a label lookup.
  return { ...parsed.data, servers: [] } as ForkWorkerCleanupResult
}
