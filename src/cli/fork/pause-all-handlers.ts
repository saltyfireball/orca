// Pause all (BAD-685, FORK.md): `orca pause-all`, `orca resume-all` and `orca pause-status`, through
// the host's fork.pauseAll.* RPC. The host fans the change out to its paired servers.
import type { CommandHandler } from '../dispatch/dispatch'
import { getOptionalStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import {
  FORK_PAUSE_ALL_SET_METHOD,
  FORK_PAUSE_ALL_STATUS_METHOD,
  formatPauseAll,
  type ForkPauseAllResult
} from '../../shared/fork/pause-all'
import type { RuntimeRpcSuccess } from '../../shared/remote-runtime/rpc/runtime-rpc-envelope'

/** `--hosts all` (the default) or `local`. */
export function readPauseHosts(raw: string | undefined): 'all' | 'local' | undefined {
  if (raw === undefined) {
    return undefined
  }
  if (raw === 'all' || raw === 'local') {
    return raw
  }
  throw new RuntimeClientError('invalid_argument', '--hosts takes all or local.')
}

async function call(
  ctx: Parameters<CommandHandler>[0],
  method: string,
  params: Record<string, unknown>
): Promise<RuntimeRpcSuccess<ForkPauseAllResult>> {
  return ctx.client.call<ForkPauseAllResult>(method, params).catch((error: unknown) => {
    if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
      throw new RuntimeClientError(
        'incompatible_runtime',
        'This Orca host has no pause-all. Update it and try again.'
      )
    }
    throw error
  })
}

async function change(ctx: Parameters<CommandHandler>[0], engaged: boolean): Promise<void> {
  const hosts = readPauseHosts(getOptionalStringFlag(ctx.flags, 'hosts'))
  const note = engaged ? getOptionalStringFlag(ctx.flags, 'note') : undefined
  const result = await call(ctx, FORK_PAUSE_ALL_SET_METHOD, {
    engaged,
    ...(hosts === 'local' ? { localOnly: true } : {}),
    ...(note ? { note } : {})
  })
  printResult(result, ctx.json, formatPauseAll)
}

export const FORK_PAUSE_ALL_HANDLERS: Record<string, CommandHandler> = {
  'pause-all': (ctx) => change(ctx, true),
  'resume-all': (ctx) => change(ctx, false),
  'pause-status': async (ctx) => {
    const hosts = readPauseHosts(getOptionalStringFlag(ctx.flags, 'hosts'))
    const result = await call(ctx, FORK_PAUSE_ALL_STATUS_METHOD, { fleet: hosts !== 'local' })
    printResult(result, ctx.json, formatPauseAll)
  }
}
