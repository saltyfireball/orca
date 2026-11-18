// Worktree ports (FORK.md, SLRM-2383): the fork.worktreePorts.get RPC behind `orca ports`.
import { z } from 'zod'
import type { ForkWorktreePortBlock } from './worktree-ports'

// A plain object with no transforms or defaults: the mobile RPC fence refuses a schema whose
// parsed shape is wider than what a sender may send.
export const ForkWorktreePortsGetParams = z.object({
  /** A workspace selector (id:, path:, branch: and the rest), resolved on the host that answers. */
  worktree: z.string().trim().min(1).max(4096)
})

export type ForkWorktreePortsGetResult = {
  worktreeId: string
  enabled: boolean
  block: ForkWorktreePortBlock | null
}
