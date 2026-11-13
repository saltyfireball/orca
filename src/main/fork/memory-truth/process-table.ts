// SLRM-2099: one process-table snapshot per poll on macOS and Linux. It replaces upstream's
// `ps -eo pid,ppid,pcpu,rss` in the memory collector (same rows, plus the process group and the
// command name), so the whole-tree attribution reads the same sweep instead of spawning again.
import { runProcess } from '@orca/process-host'
import type { ProcRow } from '../../memory/process-index'

export type ForkProcRow = ProcRow & {
  /** Process group id; 0 when unknown (Windows). */
  pgid?: number
  /** Executable name, lower-cased, without directory or `.exe`; '' when unknown. */
  name?: string
}

const PS_TIMEOUT_MS = 5_000
const PS_MAX_BUFFER = 16 * 1024 * 1024

/** `comm` goes last: on macOS it is the full executable path and may contain spaces. */
export const FORK_PS_ARGS = ['-axo', 'pid=,ppid=,pgid=,pcpu=,rss=,comm=']

export function normalizeProcessName(comm: string): string {
  const trimmed = comm.trim()
  const base = trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1)
  // A login shell shows as `-zsh`.
  return base
    .replace(/^-/, '')
    .replace(/\.exe$/i, '')
    .toLowerCase()
}

const ROW_PATTERN = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.,]+)\s+(\d+)(?:\s+(.*))?$/

export function parseForkPsOutput(stdout: string): ForkProcRow[] {
  const rows: ForkProcRow[] = []
  for (const line of stdout.split('\n')) {
    const match = ROW_PATTERN.exec(line)
    if (!match) {
      continue
    }
    const cpu = Number.parseFloat(match[4].replace(',', '.'))
    const rssKb = Number.parseInt(match[5], 10)
    rows.push({
      pid: Number.parseInt(match[1], 10),
      ppid: Number.parseInt(match[2], 10),
      pgid: Number.parseInt(match[3], 10),
      cpu: Number.isFinite(cpu) && cpu > 0 ? cpu : 0,
      memory: Number.isFinite(rssKb) && rssKb > 0 ? rssKb * 1024 : 0,
      name: normalizeProcessName(match[6] ?? '')
    })
  }
  return rows
}

export async function readForkUnixProcessTable(): Promise<ForkProcRow[]> {
  try {
    const result = await runProcess({
      program: 'ps',
      args: FORK_PS_ARGS,
      env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
      maxOutputBytes: PS_MAX_BUFFER,
      killOnOutputLimit: true,
      timeoutMs: PS_TIMEOUT_MS
    })
    // Same failures execFile rejected on: a nonzero exit, a timeout or output past the cap.
    if (result.code !== 0 || result.timedOut || result.outputTruncated) {
      throw new Error(
        `ps exited ${result.code ?? result.signal}${result.timedOut ? ' (timed out)' : ''}`
      )
    }
    return parseForkPsOutput(result.stdout)
  } catch (err) {
    console.warn('[memory] ps enumeration failed', err)
    return []
  }
}
