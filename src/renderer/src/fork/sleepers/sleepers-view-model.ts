// Sleepers (FORK.md): what the dialog adds to the host's list. The host cannot see which chats
// are on screen (it hears that only while chat sleep is on), the resource monitor's memory
// samples, or terminal agents that hibernation or workspace sleep already shut down; the
// renderer holds those, so they are laid over the host's rows here.
import type { MemorySnapshot } from '../../../../shared/process-stats-types'
import type { SleepingAgentSessionRecord } from '../../../../shared/agent-session/lifecycle/agent-session-resume'
import { buildSleeperRows, canSleepNow, type SleeperRow } from '../../../../shared/fork/sleepers'

export type SleepersRendererFacts = {
  now: number
  onScreenChatIds: ReadonlySet<string>
  /** The live pin list from settings; it can be newer than the host's last answer. */
  pinned: ReadonlySet<string>
  memoryByPaneKey: ReadonlyMap<string, number>
  sleepingRecords: Readonly<Record<string, SleepingAgentSessionRecord>>
  workspaceName: (worktreeId: string) => string
}

/** Memory per pane key, only for panes the resource monitor already sampled. */
export function sleeperMemoryByPaneKey(snapshot: MemorySnapshot | null): Map<string, number> {
  const memory = new Map<string, number>()
  for (const worktree of snapshot?.worktrees ?? []) {
    for (const session of worktree.sessions) {
      if (session.paneKey) {
        memory.set(session.paneKey, (memory.get(session.paneKey) ?? 0) + session.memory)
      }
    }
  }
  return memory
}

/** Terminal agents that are shut down and wait to resume: rows the host no longer lists. */
function sleptTerminalRows(
  facts: SleepersRendererFacts,
  listed: ReadonlySet<string>
): SleeperRow[] {
  const sources = Object.values(facts.sleepingRecords)
    .filter(
      (record) =>
        record.origin !== 'quit' && record.origin !== 'live' && !listed.has(record.paneKey)
    )
    .map((record) => ({
      id: record.paneKey,
      kind: 'terminal' as const,
      paneKey: record.paneKey,
      worktreeId: record.worktreeId,
      workspace: facts.workspaceName(record.worktreeId),
      title: record.terminalTitle?.trim() || record.prompt.trim().slice(0, 80) || record.agent,
      agent: record.agent,
      model: null,
      status: null,
      stateStartedAt: record.capturedAt,
      updatedAt: record.updatedAt,
      processAlive: false,
      hibernated: true,
      local: !record.connectionId
    }))
  return buildSleeperRows(sources, {
    now: facts.now,
    pinned: new Set(),
    onScreen: new Set(),
    memoryByPaneKey: facts.memoryByPaneKey
  })
}

export function mergeSleeperRows(
  hostRows: readonly SleeperRow[],
  facts: SleepersRendererFacts
): SleeperRow[] {
  const listed = new Set(hostRows.map((row) => row.paneKey))
  const merged = hostRows.map((row) => {
    const hibernated = row.kind === 'terminal' && Boolean(facts.sleepingRecords[row.paneKey])
    return {
      ...row,
      state: hibernated ? ('asleep' as const) : row.state,
      onScreen: row.onScreen || facts.onScreenChatIds.has(row.id),
      pinned: row.kind === 'chat' && facts.pinned.has(row.id),
      memoryBytes: row.memoryBytes ?? facts.memoryByPaneKey.get(row.paneKey) ?? null
    }
  })
  return [...merged, ...sleptTerminalRows(facts, listed)]
}

/** The workspaces the rows span, for the filter menu, by name. */
export function sleeperWorkspaces(
  rows: readonly SleeperRow[]
): { worktreeId: string; name: string }[] {
  const seen = new Map<string, string>()
  for (const row of rows) {
    if (row.worktreeId && !seen.has(row.worktreeId)) {
      seen.set(row.worktreeId, row.workspace)
    }
  }
  return [...seen]
    .map(([worktreeId, name]) => ({ worktreeId, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function formatSleeperBytes(bytes: number | null): string {
  if (bytes === null) {
    return ''
  }
  const mb = bytes / (1024 * 1024)
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`
}

export type SleeperBulkAction = 'sleep' | 'pin' | 'unpin' | 'close'

/** The selected rows a bulk action applies to; the rest are skipped, not refused. */
export function sleeperBulkTargets(
  rows: readonly SleeperRow[],
  selected: ReadonlySet<string>,
  action: SleeperBulkAction
): SleeperRow[] {
  return rows.filter((row) => {
    if (!selected.has(row.id)) {
      return false
    }
    switch (action) {
      case 'sleep':
        return canSleepNow(row)
      case 'pin':
        return row.kind === 'chat' && row.local && !row.pinned
      case 'unpin':
        return row.kind === 'chat' && row.local && row.pinned
      case 'close':
        return row.worktreeId !== null
    }
  })
}
