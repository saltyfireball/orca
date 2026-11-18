// Pooled limits (FORK.md, SLRM-2392): `orca limits usage`, through the host's fork.limits.usage.
import type { CommandHandler } from '../dispatch/dispatch'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import { formatResetDuration } from '../../shared/agent-usage/rate-limits/rate-limit-reset-format'
import type {
  ForkPooledLimitsResult,
  PooledAccountWindow,
  PooledLimitWindow,
  PooledMachine
} from '../../shared/fork/pooled-limits'

// Asking paired servers to read again can take a while; each has 15 s.
const USAGE_TIMEOUT_MS = 45_000

const PROVIDER_NAMES = { claude: 'Claude', codex: 'Codex' } as const
const WINDOW_NAMES = { session: '5-hour', weekly: 'weekly' } as const

function percent(value: number): string {
  return `${Math.round(value)}%`
}

function windowLine(window: PooledLimitWindow, now: number): string {
  const name = WINDOW_NAMES[window.kind].padEnd(7)
  const used = `${percent(window.usedPercent)} used`.padEnd(10)
  const reset =
    window.nextResetAt === null
      ? 'nothing to reset'
      : `next reset in ${formatResetDuration(window.nextResetAt - now)} frees ${percent(window.freesPercent)}`
  return `  ${name} ${used} ${reset}`
}

function accountWindow(label: string, window: PooledAccountWindow | null): string {
  return window ? `${label} ${percent(window.usedPercent)}` : `${label} -`
}

function machineWord(machine: PooledMachine): string {
  switch (machine.status) {
    case 'ok':
      return `${machine.name} (${machine.accounts})`
    case 'off':
      return `${machine.name} (pooled limits off)`
    case 'no-probe':
      return `${machine.name} (not Blackfish)`
    case 'unreachable':
      return `${machine.name} (not answering)`
  }
}

export function formatPooledLimits(result: ForkPooledLimitsResult): string {
  if (result.off) {
    return 'Pooled limits are off here (Settings > Blackfish > Usage and accounts).'
  }
  const lines: string[] = []
  for (const row of result.providers) {
    const count = row.accounts.length
    lines.push(`${PROVIDER_NAMES[row.provider]}  ${count} account${count === 1 ? '' : 's'}`)
    if (row.windows.length === 0) {
      lines.push('  no usage read yet')
    }
    lines.push(...row.windows.map((window) => windowLine(window, result.now)))
    for (const account of row.accounts) {
      lines.push(
        `    ${account.label}  ${accountWindow('5h', account.session)}  ${accountWindow('wk', account.weekly)}  on ${account.machines.join(', ')}`
      )
    }
  }
  if (lines.length === 0) {
    lines.push('No Claude or Codex account found.')
  }
  lines.push(`Machines: ${result.machines.map(machineWord).join(', ')}`)
  return lines.join('\n')
}

export const FORK_LIMITS_USAGE_HANDLERS: Record<string, CommandHandler> = {
  'limits usage': async (ctx) => {
    const refresh = ctx.flags.get('refresh') === true
    const local = ctx.flags.get('local') === true
    const reply = await ctx.client
      .call<ForkPooledLimitsResult>(
        'fork.limits.usage',
        { ...(refresh ? { refresh: true } : {}), ...(local ? { local: true } : {}) },
        { timeoutMs: USAGE_TIMEOUT_MS }
      )
      .catch((error: unknown) => {
        if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
          throw new RuntimeClientError(
            'incompatible_runtime',
            'This Orca host has no pooled limits. Update it and try again.'
          )
        }
        throw error
      })
    printResult(reply, ctx.json, formatPooledLimits)
  }
}
