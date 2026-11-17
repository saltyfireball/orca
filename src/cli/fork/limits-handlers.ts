// Limit resume (FORK.md, SLRM-2309): `orca limits`, through the host's fork.limits.* RPC.
import type { CommandHandler, HandlerContext } from '../dispatch/dispatch'
import { getOptionalStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import type { LimitResumeEntry } from '../../shared/fork/limit-resume'
import type {
  ForkLimitsActionResult,
  ForkLimitsListResult
} from '../../shared/fork/limit-resume-wire'

function incompatible(error: unknown): never {
  if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
    throw new RuntimeClientError(
      'incompatible_runtime',
      'This Orca host has no limits commands. Update it and try again.'
    )
  }
  throw error
}

function clock(at: number, now: number): string {
  const date = new Date(at)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  return date.toDateString() === new Date(now).toDateString()
    ? time
    : `${date.toDateString().slice(0, 10)} ${time}`
}

function when(entry: LimitResumeEntry, now: number): string {
  switch (entry.state) {
    case 'cancelled':
      return 'cancelled'
    case 'exhausted':
      return `waits for you (${entry.maxTries} resumes in a row)`
    case 'held':
      return `held: someone is typing (due ${clock(entry.resumeAt, now)})`
    case 'parked':
      return `resumes at ${clock(entry.resumeAt, now)}${entry.resetsAt === null ? ' (backoff)' : ''}`
  }
}

export function formatLimitsList(result: ForkLimitsListResult): string {
  if (result.entries.length === 0) {
    return 'Nothing is stopped on a usage limit.'
  }
  const rows = [
    ['ID', 'AGENT', 'NAME', 'TRIES', 'WHEN'],
    ...result.entries.map((entry) => [
      entry.id,
      entry.agent,
      entry.title.slice(0, 40),
      entry.kind === 'chat' ? '-' : `${entry.tries}/${entry.maxTries}`,
      when(entry, result.now)
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

function requireId(ctx: HandlerContext): string {
  const id = getOptionalStringFlag(ctx.flags, 'id')
  if (!id) {
    throw new RuntimeClientError('invalid_argument', 'Name one: orca limits list shows ids.')
  }
  return id
}

const OUTCOME_WORDS: Record<ForkLimitsActionResult['outcome'], string> = {
  sent: 'told to go on',
  refused: 'not sent (busy, a dialog, text in its message box, or nothing parked)',
  unknown: 'the send may have arrived; it is not sent again',
  cancelled: 'will not be resumed automatically'
}

export const FORK_LIMITS_HANDLERS: Record<string, CommandHandler> = {
  'limits list': async (ctx) => {
    const reply = await ctx.client
      .call<ForkLimitsListResult>('fork.limits.list', {})
      .catch(incompatible)
    printResult(reply, ctx.json, formatLimitsList)
  },
  'limits resume-now': async (ctx) => {
    const reply = await ctx.client
      .call<ForkLimitsActionResult>('fork.limits.resumeNow', { id: requireId(ctx) })
      .catch(incompatible)
    printResult(
      reply,
      ctx.json,
      (r) => `${r.entry.title || r.entry.id}: ${OUTCOME_WORDS[r.outcome]}`
    )
  },
  'limits cancel': async (ctx) => {
    const reply = await ctx.client
      .call<ForkLimitsActionResult>('fork.limits.cancel', { id: requireId(ctx) })
      .catch(incompatible)
    printResult(
      reply,
      ctx.json,
      (r) => `${r.entry.title || r.entry.id}: ${OUTCOME_WORDS[r.outcome]}`
    )
  }
}
