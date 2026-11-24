// SLRM-2099: the memory collector's process sweep. On macOS and Linux it reads one `ps` that adds
// the process group and the command name to upstream's rows (see process-table.ts); Windows keeps
// upstream's sweep. Kept here so `collector.ts` stays under the max-lines limit.
import os from 'node:os'
import { enumerateHostProcesses } from '../../memory/host-process-index'
import { buildProcessIndex, type ProcIndex } from '../../memory/process-index'
import { getProcessMemoryMetric } from '../../memory/process-memory-metric'
import { readDarwinProcessFootprints } from '../../memory/darwin-process-footprint'
import { readForkUnixProcessTable } from './process-table'

export async function forkEnumerateProcesses(
  options: { withStartTimes?: boolean } = {}
): Promise<ProcIndex> {
  const platform = os.platform()
  if (platform === 'win32') {
    return enumerateHostProcesses(options)
  }
  // Same rows plus process group and name, from one `ps` (LC_ALL=C for dot decimals).
  const [rows, footprints] = await Promise.all([
    readForkUnixProcessTable(),
    platform === 'darwin' ? readDarwinProcessFootprints() : Promise.resolve(null)
  ])
  return buildProcessIndex(rows, footprints, getProcessMemoryMetric(platform))
}
