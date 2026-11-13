// SLRM-2099: make upstream's memory snapshot tell the truth. Upstream counts each PTY's live
// subtree and the app's Electron processes. This adds native chats, processes that left their
// tree (reparented to init), the app's non-Electron helpers and the terminal host's leftovers,
// then writes the whole-tree numbers back into the snapshot so the badge and rows agree.
import os from 'node:os'
import { getAppEnvironment } from '../../../shared/app-environment'
import type { MemorySnapshot, UsageValues } from '../../../shared/process-stats-types'
import {
  emptyForkMemoryBreakdown,
  type ForkMemoryTruth,
  type ForkProcessMemoryMetric,
  type ForkSessionMemory,
  type ForkWorkspaceMemory
} from '../../../shared/fork/memory-truth'
import type { ProcIndex } from '../../memory/process-index'
import type { PtyRegistration } from '../../memory/pty-registry'
import { getLocalDaemonPid } from '../../memory/local-daemon-pid'
import {
  resolveWorktreeMemoryNames,
  type MemorySnapshotStore
} from '../../memory/memory-snapshot-buckets'
import {
  attributeForkProcessTrees,
  type ForkAttributedSession,
  type ForkAttributionInput,
  type ForkSessionRoot,
  type ForkStickyEntry
} from './attribution'
import { forkAgentProcessNames, readForkChatRoots } from './chat-roots'
import type { ForkProcRow } from './process-table'
import { forkMemoryStatus, sampleForkSystemMemory } from './pressure-state'
import { readLinuxPss } from './system-memory'

let sticky: ReadonlyMap<number, ForkStickyEntry> = new Map()

export function resetForkMemoryAugmentForTests(): void {
  sticky = new Map()
}

export function terminalRootsFromPtys(ptys: readonly PtyRegistration[]): ForkSessionRoot[] {
  const roots: ForkSessionRoot[] = []
  for (const pty of ptys) {
    if (pty.pid != null && pty.pid > 1) {
      roots.push({
        key: `terminal:${pty.ptyId}`,
        kind: 'terminal',
        sessionId: pty.sessionId ?? pty.ptyId,
        worktreeId: pty.worktreeId,
        provider: null,
        pid: pty.pid,
        paneKey: pty.paneKey
      })
    }
  }
  return roots
}

function toSessionMemory(session: ForkAttributedSession): ForkSessionMemory {
  return {
    kind: session.kind,
    sessionId: session.sessionId,
    provider: session.provider,
    pid: session.pid,
    memory: session.memory,
    cpu: session.cpu,
    processCount: session.processCount,
    orphanCount: session.orphanCount,
    breakdown: session.breakdown
  }
}

export function groupForkWorkspaces(
  sessions: readonly ForkAttributedSession[],
  names: (worktreeId: string) => { worktreeName: string; repoName: string }
): { workspaces: ForkWorkspaceMemory[]; unattributed: ForkSessionMemory[] } {
  const byId = new Map<string, ForkWorkspaceMemory>()
  const unattributed: ForkSessionMemory[] = []
  for (const session of sessions) {
    const row = toSessionMemory(session)
    if (!session.worktreeId) {
      unattributed.push(row)
      continue
    }
    let workspace = byId.get(session.worktreeId)
    if (!workspace) {
      const resolved = names(session.worktreeId)
      workspace = {
        worktreeId: session.worktreeId,
        worktreeName: resolved.worktreeName,
        repoName: resolved.repoName,
        memory: 0,
        cpu: 0,
        breakdown: emptyForkMemoryBreakdown(),
        sessions: []
      }
      byId.set(session.worktreeId, workspace)
    }
    workspace.memory += row.memory
    workspace.cpu += row.cpu
    for (const category of Object.keys(row.breakdown) as (keyof typeof row.breakdown)[]) {
      workspace.breakdown[category] += row.breakdown[category]
    }
    workspace.sessions.push(row)
  }
  const workspaces = [...byId.values()].sort((a, b) => b.memory - a.memory)
  for (const workspace of workspaces) {
    workspace.sessions.sort((a, b) => b.memory - a.memory)
  }
  unattributed.sort((a, b) => b.memory - a.memory)
  return { workspaces, unattributed }
}

function forkMetric(index: ProcIndex, pss: boolean): ForkProcessMemoryMetric {
  if (pss) {
    return 'pss'
  }
  if (index.hasPrivateMemory && os.platform() === 'win32') {
    return 'private-bytes'
  }
  return index.memoryMetric
}

function safeNames(
  store: MemorySnapshotStore
): (worktreeId: string) => { worktreeName: string; repoName: string } {
  return (worktreeId) => {
    try {
      const names = resolveWorktreeMemoryNames(worktreeId, store)
      return { worktreeName: names.worktreeName, repoName: names.repoName }
    } catch {
      return { worktreeName: worktreeId, repoName: '' }
    }
  }
}

/** Write the whole-tree numbers back into upstream's rows, totals and app buckets. */
function upgradeSnapshot(
  snapshot: MemorySnapshot,
  sessions: readonly ForkAttributedSession[],
  truth: ForkMemoryTruth,
  appCpu: number
): void {
  const terminals = new Map<string, ForkAttributedSession>()
  for (const session of sessions) {
    if (session.kind === 'terminal') {
      terminals.set(`${session.sessionId}\u0000${session.pid}`, session)
    }
  }
  for (const worktree of snapshot.worktrees) {
    let memory = 0
    let cpu = 0
    for (const row of worktree.sessions) {
      const whole = terminals.get(`${row.sessionId}\u0000${row.pid}`)
      if (whole) {
        row.memory = whole.memory
        row.cpu = whole.cpu
      }
      memory += row.memory
      cpu += row.cpu
    }
    worktree.memory = memory
    worktree.cpu = cpu
  }
  // Electron's main and renderers stay as upstream measured them; everything else of the app's is
  // "other" (GPU and utility processes, helpers, the terminal host).
  const app = snapshot.app
  const other: UsageValues = {
    ...app.other,
    memory: Math.max(0, truth.app.total - app.main.memory - app.renderer.memory),
    cpu: Math.max(app.other.cpu, appCpu - app.main.cpu - app.renderer.cpu)
  }
  app.other = other
  app.memory = app.main.memory + app.renderer.memory + other.memory
  app.cpu = app.main.cpu + app.renderer.cpu + other.cpu
  snapshot.totalMemory = truth.grandTotal
  snapshot.totalCpu = app.cpu + sessions.reduce((sum, session) => sum + session.cpu, 0)
}

export type ForkAugmentDeps = {
  electronPids?: () => Set<number>
  appPid?: number
  daemonPid?: () => number | null
  chatRoots?: () => ForkSessionRoot[]
  linuxPss?: boolean
  readPss?: (pids: Iterable<number>) => Promise<Map<number, number>>
  sampleSystem?: () => Promise<unknown>
}

function electronPidsNow(): Set<number> {
  return new Set(
    getAppEnvironment()
      .getAppMetrics()
      .map((proc) => proc.pid)
  )
}

export async function forkAugmentMemorySnapshot(
  snapshot: MemorySnapshot,
  index: ProcIndex,
  ptys: readonly PtyRegistration[],
  store: MemorySnapshotStore,
  deps: ForkAugmentDeps = {}
): Promise<MemorySnapshot> {
  const systemSample = (deps.sampleSystem ?? sampleForkSystemMemory)().catch(() => null)
  const windows = index.hasPrivateMemory
  const input: ForkAttributionInput = {
    byPid: index.byPid as ReadonlyMap<number, ForkProcRow>,
    childrenOf: index.childrenOf,
    roots: [...terminalRootsFromPtys(ptys), ...(deps.chatRoots ?? readForkChatRoots)()],
    electronPids: (deps.electronPids ?? electronPidsNow)(),
    appPid: deps.appPid ?? process.pid,
    daemonPid: (deps.daemonPid ?? getLocalDaemonPid)(),
    agentNames: forkAgentProcessNames(),
    sticky,
    memoryOf: windows ? (row) => row.privateMemory ?? row.memory : undefined
  }
  let result = attributeForkProcessTrees(input)
  const usePss = deps.linuxPss ?? os.platform() === 'linux'
  let pssUsed = false
  if (usePss) {
    // PSS splits shared pages between their users; read it only for the pids Orca accounts for.
    const pss = await (deps.readPss ?? readLinuxPss)([...result.sticky.keys(), ...result.appPids])
    if (pss.size > 0) {
      pssUsed = true
      result = attributeForkProcessTrees({
        ...input,
        memoryOf: (row) => pss.get(row.pid) ?? row.memory
      })
    }
  }
  sticky = result.sticky
  await systemSample

  const { workspaces, unattributed } = groupForkWorkspaces(result.sessions, safeNames(store))
  const sessionTotal = result.sessions.reduce((sum, session) => sum + session.memory, 0)
  const truth: ForkMemoryTruth = {
    metric: forkMetric(index, pssUsed),
    grandTotal: result.app.total + sessionTotal,
    app: result.app,
    workspaces,
    unattributed,
    status: forkMemoryStatus()
  }
  upgradeSnapshot(snapshot, result.sessions, truth, result.appCpu)
  snapshot.forkTruth = truth
  return snapshot
}
