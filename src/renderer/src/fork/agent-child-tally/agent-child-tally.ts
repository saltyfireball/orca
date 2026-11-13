// SLRM-2095: how many children an agent row is responsible for, from the lineage the renderer
// already holds. Pure, so the badge, the strip total and the tests share one walk.
import type {
  AgentStatusEntry,
  AgentStatusOrchestrationContext
} from '../../../../shared/agent-status/contracts/agent-status-types'
import type { AgentListStatus } from '../../../../shared/agent-status/presentation/agent-list-status'
import {
  agentChildRowContextForParent,
  buildAgentChildRowModels,
  buildLegacyAgentChildRowModels,
  type AgentChildRowModel
} from '../../../../shared/agent-status/presentation/agent-child-row-model'

/** worker: an orchestration dispatch; subagent: in-process agent; task: background shell or monitor. */
export type ChildTallyKind = 'worker' | 'subagent' | 'task'

export type ChildTallyItem = {
  key: string
  name: string
  kind: ChildTallyKind
  state: AgentListStatus
  running: boolean
  /** 1 for a direct child of the counted row, 2 for a grandchild, and so on. */
  depth: number
}

export type ChildTally = {
  running: number
  /** Running plus finished when finished children count, otherwise equal to running. */
  total: number
  /** Children at depth 1. */
  direct: number
  items: ChildTallyItem[]
}

export type ChildTallyOptions = {
  countFinished: boolean
  countTasks: boolean
}

export type ChildTallySources = {
  /** The visible orchestration contexts, keyed by row pane key (`selectVisibleAgentOrchestration`). */
  contexts: Readonly<Record<string, AgentStatusOrchestrationContext>>
  /** Live status entries first, then retained ones. */
  entryFor: (paneKey: string) => AgentStatusEntry | undefined
  /** Every known entry, used only to resolve a parent named by terminal handle. */
  entries: () => Iterable<AgentStatusEntry>
}

export const EMPTY_CHILD_TALLY: ChildTally = Object.freeze({
  running: 0,
  total: 0,
  direct: 0,
  items: []
}) as ChildTally

type WorkerIndex = {
  contexts: ChildTallySources['contexts']
  childrenByParent: Map<string, string[]>
}

let workerIndexCache: WorkerIndex | null = null

/** Parent pane key to worker pane keys, keyed on the contexts map so every row shares one build. */
export function buildWorkerIndex(sources: ChildTallySources): Map<string, string[]> {
  if (workerIndexCache?.contexts === sources.contexts) {
    return workerIndexCache.childrenByParent
  }
  let paneKeyByHandle: Map<string, string> | null = null
  const handleToPaneKey = (handle: string): string | undefined => {
    if (!paneKeyByHandle) {
      paneKeyByHandle = new Map()
      for (const entry of sources.entries()) {
        if (entry.terminalHandle && !paneKeyByHandle.has(entry.terminalHandle)) {
          paneKeyByHandle.set(entry.terminalHandle, entry.paneKey)
        }
      }
    }
    return paneKeyByHandle.get(handle)
  }
  const childrenByParent = new Map<string, string[]>()
  for (const [paneKey, context] of Object.entries(sources.contexts)) {
    const parent =
      context.parentPaneKey ??
      (context.parentTerminalHandle ? handleToPaneKey(context.parentTerminalHandle) : undefined) ??
      (context.coordinatorHandle ? handleToPaneKey(context.coordinatorHandle) : undefined)
    if (!parent || parent === paneKey) {
      continue
    }
    const siblings = childrenByParent.get(parent)
    if (siblings) {
      siblings.push(paneKey)
    } else {
      childrenByParent.set(parent, [paneKey])
    }
  }
  workerIndexCache = { contexts: sources.contexts, childrenByParent }
  return childrenByParent
}

export function _resetChildTallyCacheForTest(): void {
  workerIndexCache = null
}

function workerState(
  context: AgentStatusOrchestrationContext,
  entry: AgentStatusEntry | undefined
): { state: AgentListStatus; running: boolean } {
  const status = context.dispatchStatus
  if (status === 'completed') {
    return { state: 'done', running: false }
  }
  if (status === 'failed' || status === 'circuit_broken') {
    return { state: 'failed', running: false }
  }
  if (status === undefined && (!entry || entry.state === 'done')) {
    // A hook-only context has no dispatch state; its pane's own state is all there is.
    return { state: 'done', running: false }
  }
  if (!entry) {
    return { state: status === 'pending' ? 'idle' : 'working', running: true }
  }
  if (entry.state === 'working') {
    return { state: entry.workingMode === 'monitoring' ? 'monitoring' : 'working', running: true }
  }
  // An open dispatch whose turn ended still belongs to its coordinator.
  return { state: entry.state === 'done' ? 'idle' : entry.state, running: true }
}

function workerName(
  context: AgentStatusOrchestrationContext,
  entry: AgentStatusEntry | undefined
): string {
  return (
    context.displayName?.trim() ||
    context.taskTitle?.trim() ||
    entry?.prompt?.trim() ||
    context.taskId
  )
}

function childKind(row: AgentChildRowModel): ChildTallyKind {
  return row.kind === 'command' || row.kind === 'monitor' ? 'task' : 'subagent'
}

function childRowModels(entry: AgentStatusEntry): AgentChildRowModel[] {
  if (entry.children === undefined && (entry.subagents?.length ?? 0) === 0) {
    return []
  }
  // Freshness only changes how a live child reads, not whether it is settled.
  const context = agentChildRowContextForParent(entry, true)
  return entry.children !== undefined
    ? buildAgentChildRowModels(entry.children, context)
    : buildLegacyAgentChildRowModels(entry.subagents ?? [], context)
}

function childName(row: AgentChildRowModel): string {
  return row.name || row.agentType || (row.idSuffix ? `#${row.idSuffix}` : row.id)
}

/**
 * Everything the given rows are responsible for, transitively: workers they dispatched (in any
 * worktree, through each worker's parent pane), those workers' own workers, and every session's
 * sub-agents and background tasks. Each child counts once, however many roots reach it.
 */
export function tallyAgentChildren(
  rootPaneKeys: readonly string[],
  sources: ChildTallySources,
  options: ChildTallyOptions
): ChildTally {
  const workersByParent = buildWorkerIndex(sources)
  const items: ChildTallyItem[] = []
  const seenPanes = new Set<string>(rootPaneKeys)
  const seenItems = new Set<string>()
  const add = (item: ChildTallyItem): void => {
    if (seenItems.has(item.key)) {
      return
    }
    seenItems.add(item.key)
    if (item.kind === 'task' && !options.countTasks) {
      return
    }
    if (!item.running && !options.countFinished) {
      return
    }
    items.push(item)
  }
  const addChildWork = (ownerPaneKey: string, rows: AgentChildRowModel[], depth: number): void => {
    for (const row of rows) {
      add({
        key: `${ownerPaneKey}\u0000${row.id}`,
        name: childName(row),
        kind: childKind(row),
        state: row.displayState,
        running: !row.settled,
        depth
      })
      addChildWork(ownerPaneKey, row.owned, depth + 1)
    }
  }
  // Breadth-first so a child reached by two paths keeps its shallowest depth.
  let frontier = rootPaneKeys.map((paneKey) => ({ paneKey, depth: 0 }))
  while (frontier.length > 0) {
    const next: typeof frontier = []
    for (const { paneKey, depth } of frontier) {
      const entry = sources.entryFor(paneKey)
      if (entry) {
        addChildWork(paneKey, childRowModels(entry), depth + 1)
      }
      for (const workerPaneKey of workersByParent.get(paneKey) ?? []) {
        if (seenPanes.has(workerPaneKey)) {
          continue
        }
        seenPanes.add(workerPaneKey)
        const context = sources.contexts[workerPaneKey]
        if (!context) {
          continue
        }
        const workerEntry = sources.entryFor(workerPaneKey)
        add({
          key: workerPaneKey,
          name: workerName(context, workerEntry),
          kind: 'worker',
          ...workerState(context, workerEntry),
          depth: depth + 1
        })
        next.push({ paneKey: workerPaneKey, depth: depth + 1 })
      }
    }
    frontier = next
  }
  if (items.length === 0) {
    return EMPTY_CHILD_TALLY
  }
  let running = 0
  let direct = 0
  for (const item of items) {
    running += item.running ? 1 : 0
    direct += item.depth === 1 ? 1 : 0
  }
  return { running, total: items.length, direct, items }
}

/** Equal tallies share a signature, so a store selector can hand back the previous object. */
export function childTallySignature(tally: ChildTally): string {
  return tally.items
    .map((item) => `${item.key}\u0001${item.state}\u0001${item.running ? 1 : 0}\u0001${item.name}`)
    .join('\u0002')
}
