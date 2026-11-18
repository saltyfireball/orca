// Worktree ports (FORK.md, SLRM-2383): `orca ports` also shows the block of ports the workspace
// holds, asked of the same host the scan went to. A host without the fork RPC, or a workspace it
// cannot name, leaves the scan as it was.
import type { HandlerContext } from '../dispatch/dispatch'
import type { ForkWorktreePortsGetResult } from '../../shared/fork/worktree-ports-wire'
import { formatForkWorktreePortBlock } from '../../shared/fork/worktree-ports'

export type ForkReservedPorts = {
  enabled: boolean
  start: number | null
  count: number
  ports: number[]
}

export async function withForkReservedPorts<T extends object>(
  client: Pick<HandlerContext['client'], 'call'>,
  selector: string,
  scan: T
): Promise<T & { reservedPorts?: ForkReservedPorts }> {
  try {
    const { result } = await client.call<ForkWorktreePortsGetResult>('fork.worktreePorts.get', {
      worktree: selector
    })
    const block = result.block
    return {
      ...scan,
      reservedPorts: {
        enabled: result.enabled,
        start: block?.start ?? null,
        count: block?.count ?? 0,
        ports: block ? Array.from({ length: block.count }, (_, index) => block.start + index) : []
      }
    }
  } catch {
    return scan
  }
}

/** The scan's text with the block's line under it, when the host answered. */
export function withForkReservedPortsText(
  scan: { reservedPorts?: ForkReservedPorts },
  text: string
): string {
  const reserved = scan.reservedPorts
  const line = reserved
    ? formatForkWorktreePortBlock({
        enabled: reserved.enabled,
        block: reserved.start === null ? null : { start: reserved.start, count: reserved.count }
      })
    : null
  return line ? `${text}\n${line}` : text
}

export const FORK_PORTS_NOTES = [
  'Blackfish: each workspace also holds a block of ports (Settings forkWorktreePorts*, 10 from 20000-29999 by default), exported to its terminals, agents and setup scripts as ORCA_PORT and ORCA_PORT_0..N-1; the reserved= line and --json reservedPorts show it.'
]
