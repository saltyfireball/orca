// Auto placement (FORK.md, SLRM-2266): `orca placement`, through fork.placement.pick.
import type { CommandHandler } from '../dispatch/dispatch'
import { getOptionalStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/types'
import {
  describeForkPlacementCandidate,
  type ForkPlacementPick
} from '../../shared/fork/auto-placement'
import type { ForkPlacementPickResult } from '../../shared/fork/auto-placement-wire'

export function formatForkPlacement(result: ForkPlacementPickResult): string {
  if (result.off === true) {
    return 'Auto placement is off.'
  }
  const pick: ForkPlacementPick = result
  const lines = [
    pick.picked
      ? `auto would pick: ${pick.picked.name} (${pick.picked.hostKey})`
      : 'auto would pick nothing: no machine is eligible.',
    ...pick.ranked.map((candidate) => `  ${describeForkPlacementCandidate(candidate)}`)
  ]
  return lines.join('\n')
}

export const FORK_AUTO_PLACEMENT_HANDLERS: Record<string, CommandHandler> = {
  placement: async (ctx) => {
    const repo = getOptionalStringFlag(ctx.flags, 'repo')
    const project = getOptionalStringFlag(ctx.flags, 'project')
    const params = { ...(repo ? { repo } : {}), ...(project ? { project } : {}) }
    const result = await ctx.client
      .call<ForkPlacementPickResult>('fork.placement.pick', params, { timeoutMs: 20_000 })
      .catch((error: unknown) => {
        if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
          throw new RuntimeClientError(
            'incompatible_runtime',
            'This Orca host has no auto placement. It needs a Blackfish build with SLRM-2266.'
          )
        }
        throw error
      })
    printResult(result, ctx.json, formatForkPlacement)
  }
}
