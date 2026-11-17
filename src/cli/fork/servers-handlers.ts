// Server updates (FORK.md, SLRM-2310): `orca servers`, through the desktop's fork.servers.* RPC.
// update and rollback start a run on the desktop and follow it until every server has settled,
// printing each server's line as it changes.
import type { CommandHandler, HandlerContext } from '../dispatch/dispatch'
import {
  getOptionalNonNegativeIntegerFlag,
  getOptionalStringFlag,
  getRepeatedStringFlag
} from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import type {
  ForkServersListResult,
  ForkServersRunResult
} from '../../shared/fork/server-update-wire'
import { formatRunRow, formatServersList } from './servers-format'

const POLL_MS = 3_000
const CALL_TIMEOUT_MS = 60_000

function incompatible(error: unknown): never {
  if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
    throw new RuntimeClientError(
      'incompatible_runtime',
      'This Orca has no server updates. It needs a Blackfish build with SLRM-2310.'
    )
  }
  throw error
}

async function call<T>(ctx: HandlerContext, method: string, params: unknown) {
  return ctx.client
    .call<T>(method, params, { timeoutMs: CALL_TIMEOUT_MS })
    .catch((error: unknown) => incompatible(error))
}

function waitFlags(ctx: HandlerContext): { now?: true; waitMinutes?: number } {
  const wait = getOptionalNonNegativeIntegerFlag(ctx.flags, 'wait')
  return {
    ...(ctx.flags.get('now') === true ? { now: true as const } : {}),
    ...(wait !== undefined ? { waitMinutes: wait } : {})
  }
}

/** Follows a run to its end; prints each server's line when it changes (text mode only). */
async function follow(ctx: HandlerContext, started: ForkServersRunResult): Promise<void> {
  let run = started
  const printed = new Map<string, string>()
  const show = (): void => {
    if (ctx.json) {
      return
    }
    for (const row of run.rows) {
      const line = formatRunRow(row)
      if (printed.get(row.id) !== line && row.outcome !== 'pending') {
        printed.set(row.id, line)
        console.log(line)
      }
    }
  }
  show()
  while (!run.done) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    const reply = await call<ForkServersRunResult>(ctx, 'fork.servers.run', { runId: run.runId })
    run = reply.result
    show()
  }
  if (ctx.json) {
    console.log(JSON.stringify(run, null, 2))
  }
  if (run.rows.some((row) => row.outcome === 'failed' || row.outcome === 'rolled-back')) {
    process.exitCode = 1
  }
}

export const FORK_SERVERS_HANDLERS: Record<string, CommandHandler> = {
  'servers list': async (ctx) => {
    printResult(
      await call<ForkServersListResult>(ctx, 'fork.servers.list', {}),
      ctx.json,
      formatServersList
    )
  },
  'servers update': async (ctx) => {
    const servers = getRepeatedStringFlag(ctx.flags, 'server')
    const all = ctx.flags.get('all') === true
    if (all === servers.length > 0) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Name the servers to update, or pass --all (not both). `orca servers list` shows them.'
      )
    }
    const version = getOptionalStringFlag(ctx.flags, 'version')
    const reply = await call<ForkServersRunResult>(ctx, 'fork.servers.update', {
      ...(all ? { all: true } : { servers }),
      ...(version ? { version } : {}),
      ...(ctx.flags.get('allow-downgrade') === true ? { allowDowngrade: true } : {}),
      ...waitFlags(ctx)
    })
    if (!ctx.json) {
      console.log(
        `Updating ${reply.result.rows.length} servers to ${reply.result.targetVersion}, one at a time.`
      )
    }
    await follow(ctx, reply.result)
  },
  'servers rollback': async (ctx) => {
    const server = getOptionalStringFlag(ctx.flags, 'server')
    if (!server) {
      throw new RuntimeClientError('invalid_argument', 'Name the server to roll back.')
    }
    const reply = await call<ForkServersRunResult>(ctx, 'fork.servers.rollback', {
      server,
      ...waitFlags(ctx)
    })
    await follow(ctx, reply.result)
  }
}
