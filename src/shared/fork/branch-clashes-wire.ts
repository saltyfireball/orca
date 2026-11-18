// Branch clashes (FORK.md, SLRM-2394): the fork.clashes.* RPC contract behind `orca clashes` and
// the paired-server fan-out, and the desktop window's bridge.
import { z } from 'zod'
import type { ForkClashResult } from './branch-clashes'

const Project = z.string().trim().min(1).max(256)

// Plain objects with no transforms or defaults: the mobile RPC fence refuses a schema whose parsed
// shape is wider than what a sender may send.
/** This host's own branches; the desktop asks each paired server with it. */
export const ForkClashesLocalParams = z.object({ project: Project.optional() })

/** This host and its paired servers, folded into clashes. */
export const ForkClashesScanParams = z.object({
  project: Project.optional(),
  /** Read git now instead of answering from the last check. */
  refresh: z.boolean().optional()
})

/** How long one paired server may take to report its branches. */
export const FORK_CLASHES_HOST_TIMEOUT_MS = 60_000

export const FORK_CLASHES_CHANNELS = {
  get: 'fork-clashes:get',
  refresh: 'fork-clashes:refresh',
  changed: 'fork-clashes:changed'
} as const

/** window.api.forkClashes: the desktop window's side. */
export type ForkClashesApi = {
  get: () => Promise<ForkClashResult | null>
  refresh: () => Promise<ForkClashResult | null>
  onChanged: (callback: (result: ForkClashResult | null) => void) => () => void
}
