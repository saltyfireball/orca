// Chat stall (FORK.md): is a stalled chat's provider still running? Reads the process table once
// and judges the provider tree from its root (the pid the chat's lease records: the provider
// supervisor, or a chat-survive broker in front of it). Electron-free, so tests feed it a table.
import { execFile } from 'node:child_process'
import type { ForkChatStallLiveness } from '../../../shared/fork/chat-stall'
import { forkProviderWriterParents } from '../chat-survive/chat-survive-writer'

export type ForkProcessRow = { pid: number; ppid: number; pgid: number; stat: string }

export type ForkProviderTreeVerdict = {
  liveness: Exclude<ForkChatStallLiveness, 'unknown'>
  /** Processes of the tree in the stopped state, for Wake. */
  stoppedPids: number[]
}

const PS_TIMEOUT_MS = 5_000

/** `ps -o pid=,ppid=,pgid=,stat=` lines; anything unreadable is skipped. */
export function parseForkProcessRows(text: string): ForkProcessRow[] {
  const rows: ForkProcessRow[] = []
  for (const line of text.split('\n')) {
    const [pid, ppid, pgid, stat] = line.trim().split(/\s+/)
    const numbers = [pid, ppid, pgid].map(Number)
    if (stat && numbers.every((n) => Number.isSafeInteger(n) && n >= 0)) {
      rows.push({ pid: numbers[0], ppid: numbers[1], pgid: numbers[2], stat })
    }
  }
  return rows
}

/** The process table, or null when it cannot be read (Windows has no ps). */
export function readForkProcessRows(
  platform: NodeJS.Platform = process.platform
): Promise<ForkProcessRow[] | null> {
  if (platform === 'win32') {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    execFile(
      'ps',
      ['-A', '-o', 'pid=,ppid=,pgid=,stat='],
      { timeout: PS_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => resolve(error ? null : parseForkProcessRows(stdout))
    )
  })
}

function descendantsOf(rootPid: number, rows: readonly ForkProcessRow[]): ForkProcessRow[] {
  const found: ForkProcessRow[] = []
  const seen = new Set([rootPid])
  for (let index = -1; index < found.length; index += 1) {
    const parent = index < 0 ? rootPid : found[index].pid
    for (const row of rows) {
      if (row.ppid === parent && !seen.has(row.pid)) {
        seen.add(row.pid)
        found.push(row)
      }
    }
  }
  return found
}

const isStopped = (row: ForkProcessRow): boolean => row.stat.startsWith('T')

/**
 * Gone when the root is missing or a zombie. Stopped when the root, a supervisor under a broker,
 * or a writer (a group-leading child of either) is stopped: a stopped tool deeper down is the
 * tool's own business and leaves the provider alive. Wake resumes every stopped process of the
 * tree, so a group stopped as a whole runs again.
 */
export function judgeForkProviderTree(
  rootPid: number,
  rows: readonly ForkProcessRow[]
): ForkProviderTreeVerdict {
  const root = rows.find((row) => row.pid === rootPid)
  if (!root || root.stat.startsWith('Z')) {
    return { liveness: 'gone', stoppedPids: [] }
  }
  const descendants = descendantsOf(rootPid, rows)
  const parents = forkProviderWriterParents(rootPid, {
    rootPgid: root.pgid,
    descendants: descendants.map(({ pid, ppid, pgid }) => ({ pid, ppid, pgid, startedAt: '' })),
    capturedAtMs: 0
  })
  const chain = [root, ...descendants].filter(
    (row) => parents.has(row.pid) || (parents.has(row.ppid) && row.pgid === row.pid)
  )
  const stoppedPids = [root, ...descendants].filter(isStopped).map((row) => row.pid)
  return { liveness: chain.some(isStopped) ? 'stopped' : 'alive', stoppedPids }
}
