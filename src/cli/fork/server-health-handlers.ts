// SLRM-2311 (FORK.md "Server health"): `orca servers health`, through fork.serverHealth.list.
import type { CommandHandler } from '../dispatch/dispatch'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import {
  FORK_SERVER_HEALTH_LIST_METHOD,
  formatForkDuration,
  type ForkServerHealthEntry,
  type ForkServerHealthListResult
} from '../../shared/fork/server-health'

const STATE_LABEL: Record<ForkServerHealthEntry['state'], string> = {
  up: 'answering',
  down: 'not answering',
  offline: 'offline',
  recovering: 'answering again',
  unwatched: 'not watched'
}

const HEARTBEAT_LABEL: Record<ForkServerHealthListResult['heartbeat']['state'], string> = {
  off: 'off',
  invalid: 'off, the address is not a valid http(s) URL',
  ok: 'working',
  failing: 'failing'
}

function when(ms: number | null): string {
  return ms === null ? '-' : new Date(ms).toISOString().slice(0, 16).replace('T', ' ')
}

function detail(entry: ForkServerHealthEntry, now: number): string {
  if (entry.downSince !== null) {
    return `for ${formatForkDuration(now - entry.downSince)}`
  }
  if (entry.lastOutage) {
    return `last outage ${formatForkDuration(entry.lastOutage.downtimeMs)}, ended ${when(entry.lastOutage.endedAt)}`
  }
  return ''
}

export function formatServerHealth(result: ForkServerHealthListResult, now = Date.now()): string {
  const lines: string[] = []
  if (!result.enabled) {
    lines.push('Server health is off on this host (forkServerHealth).')
  } else if (result.servers.length === 0) {
    lines.push('No paired remote servers watched by this host.')
  } else {
    lines.push(
      `Offline alert after ${result.offlineMinutes} min without an answer.`,
      ['NAME'.padEnd(28), 'STATE'.padEnd(16), 'LAST SEEN'.padEnd(17), 'NOTE'].join('  ')
    )
    for (const entry of result.servers) {
      const name = entry.name.length > 28 ? `${entry.name.slice(0, 25)}...` : entry.name
      lines.push(
        [
          name.padEnd(28),
          STATE_LABEL[entry.state].padEnd(16),
          when(entry.lastSeenAt).padEnd(17),
          detail(entry, now)
        ]
          .join('  ')
          .trimEnd()
      )
    }
  }
  const beat = result.heartbeat
  lines.push(
    `Heartbeat: ${HEARTBEAT_LABEL[beat.state]}${beat.lastOkAt === null ? '' : `, last success ${when(beat.lastOkAt)}`}`
  )
  return lines.join('\n')
}

export const FORK_SERVER_HEALTH_HANDLERS: Record<string, CommandHandler> = {
  'servers health': async (ctx) => {
    const result = await ctx.client
      .call<ForkServerHealthListResult>(FORK_SERVER_HEALTH_LIST_METHOD, {})
      .catch((error: unknown) => {
        if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
          throw new RuntimeClientError(
            'incompatible_runtime',
            'This Orca host has no server health. It needs a Blackfish build with SLRM-2311.'
          )
        }
        throw error
      })
    printResult(result, ctx.json, (value) => formatServerHealth(value))
  }
}
