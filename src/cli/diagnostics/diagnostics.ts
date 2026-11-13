import type { MemorySnapshot } from '../../shared/process-stats-types'
import type { CommandHandler } from '../dispatch/dispatch'
import { formatMemorySnapshot } from './memory-snapshot-format'
import { printResult } from '../output/command-result-output'
import { TERMINAL_DAEMON_HANDLERS } from '../terminals/terminal-daemon'
// Fork (SLRM-2099): whole-tree memory, system memory and the warning status.
import { withForkMemoryTruth } from '../fork/memory-truth-format'

export const DIAGNOSTICS_HANDLERS: Record<string, CommandHandler> = {
  'diagnostics memory': async ({ client, json }) => {
    const result = await client.call<MemorySnapshot>('diagnostics.memory')
    printResult(result, json, withForkMemoryTruth(formatMemorySnapshot))
  },
  ...TERMINAL_DAEMON_HANDLERS
}
