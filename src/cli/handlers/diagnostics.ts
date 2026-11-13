import type { MemorySnapshot } from '../../shared/process-stats-types'
import type { CommandHandler } from '../dispatch'
import { formatMemorySnapshot, printResult } from '../format'
import { TERMINAL_DAEMON_HANDLERS } from './terminal-daemon'
// Fork (SLRM-2099): whole-tree memory, system memory and the warning status.
import { withForkMemoryTruth } from '../fork/memory-truth-format'

export const DIAGNOSTICS_HANDLERS: Record<string, CommandHandler> = {
  'diagnostics memory': async ({ client, json }) => {
    const result = await client.call<MemorySnapshot>('diagnostics.memory')
    printResult(result, json, withForkMemoryTruth(formatMemorySnapshot))
  },
  ...TERMINAL_DAEMON_HANDLERS
}
