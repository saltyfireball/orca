// Auto placement (FORK.md, SLRM-2266): the fork.placement.* RPC contract shared by the CLI and the
// host that answers.
import { z } from 'zod'
import type { ForkMachineLoad, ForkPlacementPick } from './auto-placement'

/** Most machines one pick may name. */
export const FORK_PLACEMENT_MAX_HOSTS = 64

/** Each machine's probe gets this long; a slower machine counts as unreachable. */
export const FORK_PLACEMENT_PROBE_TIMEOUT_MS = 2_500

const Repo = z.string().min(1).max(4096)

/** One machine's own load; with `repo`, also whether that repo selector resolves there. */
export const ForkPlacementLoadParams = z.object({ repo: Repo.optional() })

export type ForkPlacementLoadResult = { load: ForkMachineLoad; repoFound?: boolean }

export const ForkPlacementPickParams = z.object({
  /** Machines to consider ('local', 'runtime:<id>'); unset is this machine and every paired server. */
  hosts: z.array(z.string().min(1).max(512)).max(FORK_PLACEMENT_MAX_HOSTS).optional(),
  /** Only machines where this repo selector resolves. */
  repo: Repo.optional(),
  /** Asked because no machine was named: answers `{ off: true }` unless the setting is on. */
  unnamed: z.boolean().optional()
})

export type ForkPlacementPickResult = ({ off?: false } & ForkPlacementPick) | { off: true }
