// Sleepers (FORK.md): `orca sleepers`, through the host's fork.sleepers.* RPC. Wake
// uses the stock agentSession.reveal, which opens the chat on the desktop.
import type { CommandHandler, HandlerContext } from '../dispatch'
import { getOptionalStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import {
  resolveSleeper,
  sortSleepers,
  type SleeperRow,
  type SleeperState
} from '../../shared/fork/sleepers'
import type {
  ForkSleepResult,
  ForkSleepersListResult,
  ForkSleepersPinResult,
  ForkSleepersSleepResult
} from '../../shared/fork/sleepers-wire'

const STATE: Record<SleeperState, string> = {
  working: 'working',
  stalled: 'stalled',
  'needs-input': 'needs input',
  queued: 'queued',
  'awake-idle': 'awake idle',
  asleep: 'asleep'
}

const RESULT: Record<ForkSleepResult, string> = {
  asleep: 'asleep',
  'already-asleep': 'was already asleep',
  busy: 'left awake: it has work in flight (a turn, a question, queued messages or subagents)',
  'not-found': 'no such chat on this host',
  unavailable: 'the chat host is not running here'
}

export function formatDuration(ms: number | null): string {
  if (ms === null) {
    return '-'
  }
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) {
    return '<1m'
  }
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  return hours < 48
    ? `${hours}h${String(minutes % 60).padStart(2, '0')}m`
    : `${Math.floor(hours / 24)}d`
}

/** Queued: place, reason and the command that starts it. Stalled: how long it has been quiet. */
function lifecycleNote(row: SleeperRow, now: number): string {
  if (row.queue) {
    const why = row.queue.heldReason ? ` (${row.queue.heldReason})` : ''
    return `queue #${row.queue.position}${why}, start: orca agent queue start ${row.queue.id}`
  }
  if (row.stall) {
    const stopped = row.stall.liveness === 'stopped' ? ', process stopped' : ''
    return `quiet ${formatDuration(now - row.stall.quietSince)}${stopped}`
  }
  return ''
}

function mark(row: SleeperRow, now: number): string {
  return [
    lifecycleNote(row, now),
    row.pinned ? 'pinned' : '',
    row.onScreen ? 'on screen' : '',
    row.local ? '' : 'remote'
  ]
    .filter(Boolean)
    .join(', ')
}

export function formatSleepers(result: ForkSleepersListResult): string {
  if (result.rows.length === 0) {
    return 'No chats or terminal agents.'
  }
  const table = [
    ['ID', 'KIND', 'STATE', 'IDLE', 'LAST ACTIVITY', 'WORKSPACE', 'MODEL', 'TITLE', ''],
    ...sortSleepers(result.rows, 'idle', true).map((row) => [
      row.kind === 'chat' ? row.id.slice(0, 8) : row.id,
      row.kind,
      STATE[row.state],
      formatDuration(row.idleMs),
      `${formatDuration(result.now - row.lastActivityAt)} ago`,
      row.workspace,
      row.model ?? '-',
      row.title,
      mark(row, result.now)
    ])
  ]
  const widths = table[0].map((_, col) => Math.max(...table.map((cells) => cells[col].length)))
  return table
    .map((cells) =>
      cells
        .map((cell, col) => cell.padEnd(widths[col]))
        .join('  ')
        .trimEnd()
    )
    .join('\n')
}

function incompatible(error: unknown): never {
  if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
    throw new RuntimeClientError(
      'incompatible_runtime',
      'This Orca host has no sleepers commands. Update the desktop app and try again.'
    )
  }
  throw error
}

function list(ctx: HandlerContext) {
  return ctx.client.call<ForkSleepersListResult>('fork.sleepers.list', {}).catch(incompatible)
}

/** The one row an id or prefix names, else a usage error that says why. */
export function pickSleeper(rows: readonly SleeperRow[], id: string | undefined): SleeperRow {
  if (!id) {
    throw new RuntimeClientError('invalid_argument', 'Name a chat: orca sleepers list shows ids.')
  }
  const found = resolveSleeper(rows, id)
  if (found.ok) {
    return found.row
  }
  const why =
    found.error === 'ambiguous'
      ? `"${id}" matches ${found.matches.length} agents; type more of the id.`
      : `No chat or agent with id "${id}".`
  throw new RuntimeClientError('invalid_argument', why)
}

function requireChat(row: SleeperRow, verb: string): void {
  if (row.kind !== 'chat') {
    throw new RuntimeClientError(
      'invalid_argument',
      `Only native chats can ${verb} here; terminal agents sleep and wake with their workspace or tab.`
    )
  }
}

async function setPinned(ctx: HandlerContext, pinned: boolean): Promise<void> {
  const row = pickSleeper((await list(ctx)).result.rows, getOptionalStringFlag(ctx.flags, 'id'))
  requireChat(row, pinned ? 'be pinned' : 'be unpinned')
  const reply = await ctx.client
    .call<ForkSleepersPinResult>('fork.sleepers.pin', { sessionId: row.id, pinned })
    .catch(incompatible)
  printResult(reply, ctx.json, (r) => `${row.title}: ${r.pinned ? 'pinned' : 'unpinned'}`)
}

export function formatSleepOutcomes(
  result: ForkSleepersSleepResult,
  titles: ReadonlyMap<string, string>
): string {
  if (result.outcomes.length === 0) {
    return 'No idle chats to sleep.'
  }
  return result.outcomes
    .map((o) => `${titles.get(o.sessionId) ?? o.sessionId}: ${RESULT[o.result]}`)
    .join('\n')
}

export const FORK_SLEEPERS_HANDLERS: Record<string, CommandHandler> = {
  'sleepers list': async (ctx) => {
    printResult(await list(ctx), ctx.json, formatSleepers)
  },
  'sleepers sleep': async (ctx) => {
    const { rows } = (await list(ctx)).result
    const titles = new Map(rows.map((row) => [row.id, row.title]))
    let params: Record<string, unknown>
    if (ctx.flags.get('all-idle') === true) {
      params = { allIdle: true, exceptVisible: ctx.flags.get('except-visible') === true }
    } else {
      const row = pickSleeper(rows, getOptionalStringFlag(ctx.flags, 'id'))
      requireChat(row, 'sleep')
      params = { sessionIds: [row.id] }
    }
    const reply = await ctx.client
      .call<ForkSleepersSleepResult>('fork.sleepers.sleep', params)
      .catch(incompatible)
    printResult(reply, ctx.json, (r) => formatSleepOutcomes(r, titles))
  },
  'sleepers wake': async (ctx) => {
    const row = pickSleeper((await list(ctx)).result.rows, getOptionalStringFlag(ctx.flags, 'id'))
    requireChat(row, 'wake')
    const reply = await ctx.client.call<unknown>('agentSession.reveal', { sessionId: row.id })
    printResult(reply, ctx.json, () => `${row.title}: opened; it starts on your next message`)
  },
  'sleepers pin': (ctx) => setPinned(ctx, true),
  'sleepers unpin': (ctx) => setPinned(ctx, false)
}
