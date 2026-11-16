// Snooze (FORK.md, SLRM-2269): `orca snooze`, through the desktop's fork.snooze.* RPC.
import type { CommandHandler, HandlerContext } from '../dispatch/dispatch'
import { getOptionalStringFlag, getRequiredStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import {
  normalizeWorktreeSelectorForCaller,
  resolveCurrentWorktreeSelector
} from '../workspace-selection/workspace-selector'
import { forkSnoozeWakeLabel, type ForkSnoozeEntry } from '../../shared/fork/snooze'
import type {
  ForkSnoozeListResult,
  ForkSnoozeSetResult,
  ForkSnoozeWakeResult
} from '../../shared/fork/snooze-wire'

function incompatible(error: unknown): never {
  if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
    throw new RuntimeClientError(
      'incompatible_runtime',
      'This Orca host has no snooze commands. Update the desktop app and try again.'
    )
  }
  throw error
}

function what(entry: ForkSnoozeEntry): string {
  return entry.target.kind === 'workspace'
    ? `workspace${entry.target.hostId === 'local' ? '' : ` on ${entry.target.hostId}`}`
    : 'chat'
}

export function formatSnoozeList(result: ForkSnoozeListResult): string {
  if (result.entries.length === 0) {
    return 'Nothing is snoozed.'
  }
  const rows = [
    ['ID', 'KIND', 'NAME', 'WAKES'],
    ...result.entries.map((entry) => [
      entry.id,
      what(entry),
      entry.label,
      forkSnoozeWakeLabel(entry.until, result.now)
    ])
  ]
  const widths = rows[0].map((_, col) => Math.max(...rows.map((cells) => cells[col].length)))
  return rows
    .map((cells) =>
      cells
        .map((cell, col) => cell.padEnd(widths[col]))
        .join('  ')
        .trimEnd()
    )
    .join('\n')
}

/** The target as the host resolves it: chat:<id> as is, a workspace selector made absolute. */
async function targetSelector(ctx: HandlerContext, host: string | undefined): Promise<string> {
  const target = getOptionalStringFlag(ctx.flags, 'target')
  if (target?.startsWith('chat:') || (target && host && host !== 'local')) {
    return target
  }
  return target
    ? normalizeWorktreeSelectorForCaller(target, ctx.cwd, ctx.client)
    : resolveCurrentWorktreeSelector(ctx.cwd, ctx.client)
}

export const FORK_SNOOZE_HANDLERS: Record<string, CommandHandler> = {
  'snooze list': async (ctx) => {
    const reply = await ctx.client
      .call<ForkSnoozeListResult>('fork.snooze.list', {})
      .catch(incompatible)
    printResult(reply, ctx.json, formatSnoozeList)
  },
  'snooze wake': async (ctx) => {
    const id = getOptionalStringFlag(ctx.flags, 'id')
    if (!id) {
      throw new RuntimeClientError('invalid_argument', 'Name a snooze: orca snooze list shows ids.')
    }
    const reply = await ctx.client
      .call<ForkSnoozeWakeResult>('fork.snooze.wake', { id })
      .catch(incompatible)
    printResult(reply, ctx.json, (r) => `${r.entry.label}: awake`)
  },
  snooze: async (ctx) => {
    const until = getRequiredStringFlag(ctx.flags, 'until')
    const host = getOptionalStringFlag(ctx.flags, 'host')
    const target = await targetSelector(ctx, host)
    const reply = await ctx.client
      .call<ForkSnoozeSetResult>('fork.snooze.set', { target, until, ...(host ? { host } : {}) })
      .catch(incompatible)
    printResult(
      reply,
      ctx.json,
      (r) =>
        `${r.entry.label}: snoozed ${forkSnoozeWakeLabel(r.entry.until, Date.now())} (${r.entry.id})`
    )
  }
}
