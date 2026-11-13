// SLRM-2099: attribute one process-table snapshot to sessions, whole trees at a time. Pure: the
// table, the session roots and the last sweep's memory of who owned what come in as arguments.
import {
  emptyForkMemoryBreakdown,
  type ForkAppMemory,
  type ForkMemoryBreakdown,
  type ForkMemoryCategory
} from '../../../shared/fork/memory-truth'
import type { ForkProcRow } from './process-table'

export type ForkSessionRoot = {
  /** Unique across kinds: `terminal:<id>` or `chat:<id>`. */
  key: string
  kind: 'terminal' | 'chat'
  sessionId: string
  worktreeId: string | null
  provider: string | null
  /** Top of the tree: the PTY's shell, or the chat's provider (its supervisor on POSIX). */
  pid: number
  /** Upstream's PTY pane key, kept so the popover rows still match their tabs. */
  paneKey?: string | null
}

/** What the last sweep knew about a process, so it is still found after it is reparented. */
export type ForkStickyEntry = { key: string; name: string; category: ForkMemoryCategory }

export type ForkAttributionInput = {
  byPid: ReadonlyMap<number, ForkProcRow>
  childrenOf: ReadonlyMap<number, readonly number[]>
  roots: readonly ForkSessionRoot[]
  /** Electron's own processes (getAppMetrics). */
  electronPids: ReadonlySet<number>
  /** The Electron main process: helpers are its other descendants. */
  appPid: number
  /** The detached terminal host, when one runs. */
  daemonPid: number | null
  agentNames: ReadonlySet<string>
  sticky: ReadonlyMap<number, ForkStickyEntry>
  /** Bytes for a row; defaults to row.memory. */
  memoryOf?: (row: ForkProcRow) => number
}

export type ForkAttributedSession = ForkSessionRoot & {
  memory: number
  cpu: number
  processCount: number
  orphanCount: number
  breakdown: ForkMemoryBreakdown
}

export type ForkAttribution = {
  sessions: ForkAttributedSession[]
  app: ForkAppMemory
  appCpu: number
  /** Pids counted into `app`, in no particular order. */
  appPids: number[]
  /** Feed back into the next sweep's `sticky`. */
  sticky: Map<number, ForkStickyEntry>
}

export const FORK_SHELL_NAMES: ReadonlySet<string> = new Set([
  'sh',
  'bash',
  'zsh',
  'fish',
  'dash',
  'ksh',
  'mksh',
  'tcsh',
  'csh',
  'nu',
  'elvish',
  'xonsh',
  'pwsh',
  'powershell',
  'cmd',
  'login'
])

/** Script runtimes an agent CLI may run under; directly under a chat's root they are the agent. */
const RUNTIME_NAMES: ReadonlySet<string> = new Set(['node', 'bun', 'deno', 'python', 'python3'])

/** Init and subreapers: a child of one of these may have been reparented. */
const REAPER_NAMES: ReadonlySet<string> = new Set(['launchd', 'init', 'systemd'])

export function classifyForkProcess(
  name: string,
  parent: ForkMemoryCategory | null,
  context: { isChatRoot: boolean; parentIsChatRoot: boolean; agentNames: ReadonlySet<string> }
): ForkMemoryCategory {
  if (context.isChatRoot) {
    return 'agent'
  }
  if (FORK_SHELL_NAMES.has(name)) {
    return 'shells'
  }
  if (context.agentNames.has(name) || (context.parentIsChatRoot && RUNTIME_NAMES.has(name))) {
    return 'agent'
  }
  return parent === 'agent' || parent === 'tools' ? 'tools' : 'other'
}

type Tally = Omit<ForkAttributedSession, keyof ForkSessionRoot>

function emptyTally(): Tally {
  return {
    memory: 0,
    cpu: 0,
    processCount: 0,
    orphanCount: 0,
    breakdown: emptyForkMemoryBreakdown()
  }
}

export function attributeForkProcessTrees(input: ForkAttributionInput): ForkAttribution {
  const memoryOf = input.memoryOf ?? ((row: ForkProcRow) => row.memory)
  const claimed = new Map<number, string>()
  const sticky = new Map<number, ForkStickyEntry>()
  const tallies = new Map<string, Tally>()
  // Never walk into the app or the terminal host from a session root.
  const fence = new Set<number>([input.appPid, ...input.electronPids])
  if (input.daemonPid !== null) {
    fence.add(input.daemonPid)
  }

  const walk = (
    root: ForkSessionRoot,
    startPid: number,
    startParent: ForkMemoryCategory | null,
    orphan: boolean
  ): void => {
    const tally = tallies.get(root.key) ?? emptyTally()
    tallies.set(root.key, tally)
    const stack: { pid: number; parent: ForkMemoryCategory | null; parentIsRoot: boolean }[] = [
      { pid: startPid, parent: startParent, parentIsRoot: false }
    ]
    while (stack.length > 0) {
      const next = stack.pop()
      if (!next || claimed.has(next.pid) || fence.has(next.pid)) {
        continue
      }
      const row = input.byPid.get(next.pid)
      if (!row) {
        continue
      }
      const isChatRoot = !orphan && root.kind === 'chat' && next.pid === root.pid
      const name = row.name ?? ''
      const category = classifyForkProcess(name, next.parent, {
        isChatRoot,
        parentIsChatRoot: next.parentIsRoot,
        agentNames: input.agentNames
      })
      claimed.set(row.pid, root.key)
      sticky.set(row.pid, { key: root.key, name, category })
      const bytes = memoryOf(row)
      tally.memory += bytes
      tally.cpu += row.cpu
      tally.processCount++
      tally.orphanCount += orphan ? 1 : 0
      tally.breakdown[category] += bytes
      // A runtime right under the chat's root is the agent only when the root is a supervisor
      // rather than the agent CLI itself (then it is one of the agent's tool servers).
      const rootIsSupervisor = isChatRoot && !input.agentNames.has(name)
      for (const kid of input.childrenOf.get(row.pid) ?? []) {
        stack.push({ pid: kid, parent: category, parentIsRoot: rootIsSupervisor })
      }
    }
  }

  const rootsByKey = new Map<string, ForkSessionRoot>()
  for (const root of input.roots) {
    rootsByKey.set(root.key, root)
    walk(root, root.pid, null, false)
  }

  // Reparented processes: the pid the last sweep saw in a session (same name), else a process
  // group a session's processes lead or share, as long as that group is not the app's own.
  const sharedGroups = new Set<number>([0, 1])
  for (const pid of fence) {
    const group = input.byPid.get(pid)?.pgid
    if (group !== undefined) {
      sharedGroups.add(group)
    }
  }
  const groupOwner = new Map<number, string>()
  for (const [pid, key] of claimed) {
    const group = input.byPid.get(pid)?.pgid
    if (group !== undefined && !sharedGroups.has(group) && !groupOwner.has(group)) {
      groupOwner.set(group, key)
    }
  }
  for (const row of input.byPid.values()) {
    if (claimed.has(row.pid) || fence.has(row.pid)) {
      continue
    }
    const parent = input.byPid.get(row.ppid)
    const reparented = row.ppid <= 1 || !parent || REAPER_NAMES.has(parent.name ?? '')
    if (!reparented) {
      continue
    }
    const remembered = input.sticky.get(row.pid)
    const key =
      remembered && remembered.name === (row.name ?? '') && rootsByKey.has(remembered.key)
        ? remembered.key
        : row.pgid !== undefined
          ? groupOwner.get(row.pgid)
          : undefined
    const root = key === undefined ? undefined : rootsByKey.get(key)
    if (root) {
      walk(root, row.pid, remembered && remembered.key === key ? remembered.category : null, true)
    }
  }

  // The app: Electron's own processes, its other descendants, and the terminal host's leftovers.
  const counted = new Set<number>(claimed.keys())
  const app: ForkAppMemory = { total: 0, electron: 0, helpers: 0, terminalHost: 0 }
  let appCpu = 0
  const appPids: number[] = []
  const add = (row: ForkProcRow, bucket: 'electron' | 'helpers' | 'terminalHost'): void => {
    counted.add(row.pid)
    appPids.push(row.pid)
    const bytes = memoryOf(row)
    app[bucket] += bytes
    app.total += bytes
    appCpu += row.cpu
  }
  for (const pid of input.electronPids) {
    const row = input.byPid.get(pid)
    if (row && !counted.has(pid)) {
      add(row, 'electron')
    }
  }
  const sweep = (start: number, bucket: 'helpers' | 'terminalHost'): void => {
    const stack = [start]
    while (stack.length > 0) {
      const pid = stack.pop()
      if (pid === undefined || claimed.has(pid)) {
        continue
      }
      const row = input.byPid.get(pid)
      if (row && !counted.has(pid)) {
        add(row, input.electronPids.has(pid) ? 'electron' : bucket)
      }
      stack.push(...(input.childrenOf.get(pid) ?? []))
    }
  }
  if (input.daemonPid !== null) {
    sweep(input.daemonPid, 'terminalHost')
  }
  sweep(input.appPid, 'helpers')

  const sessions = input.roots.map((root) => ({
    ...root,
    ...(tallies.get(root.key) ?? emptyTally())
  }))
  return { sessions, app, appCpu, appPids, sticky }
}
