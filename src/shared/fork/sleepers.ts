// Sleepers (FORK.md): one list of every native chat and terminal agent, with its sleep state,
// so a user can see what is holding a process and put it to sleep, wake it, or pin it awake.
// Both the desktop dialog and `orca sleepers` build their rows here from the same inputs.
import type { ForkGlobalSettings } from './fork-global-settings'

export type SleeperKind = 'chat' | 'terminal'

/** `needs-input` is a blocked or waiting agent: it asked the user something. */
export type SleeperState = 'working' | 'needs-input' | 'awake-idle' | 'asleep'

export const SLEEPER_STATES: readonly SleeperState[] = [
  'working',
  'needs-input',
  'awake-idle',
  'asleep'
]

/** What one source (the runtime's agent rows, or the renderer's status feed) knows of an agent. */
export type SleeperSource = {
  /** A chat's session id, or a terminal agent's pane key. */
  id: string
  kind: SleeperKind
  paneKey: string
  worktreeId: string | null
  workspace: string
  title: string
  agent: string | null
  model: string | null
  /** The agent status row's state; absent for a row with no status (a slept terminal). */
  status: 'working' | 'blocked' | 'waiting' | 'done' | null
  stateStartedAt: number
  updatedAt: number
  /** Chat: the provider process runs. Terminal: the pane's PTY is live. */
  processAlive: boolean
  /** A terminal agent that hibernation or workspace sleep shut down. */
  hibernated?: boolean
  /** This process's own host owns the agent, so sleep and pin act here. */
  local: boolean
}

export type SleeperRow = Omit<SleeperSource, 'status' | 'processAlive' | 'hibernated'> & {
  state: SleeperState
  /** Milliseconds since the agent went idle; null while it works or waits on the user. */
  idleMs: number | null
  lastActivityAt: number
  pinned: boolean
  onScreen: boolean
  /** Bytes, only when the resource monitor already sampled this pane. */
  memoryBytes: number | null
}

export function deriveSleeperState(
  source: Pick<SleeperSource, 'status' | 'processAlive' | 'hibernated'>
): SleeperState {
  if (source.hibernated) {
    return 'asleep'
  }
  if (source.status === 'working') {
    return source.processAlive ? 'working' : 'asleep'
  }
  if (source.status === 'blocked' || source.status === 'waiting') {
    return source.processAlive ? 'needs-input' : 'asleep'
  }
  return source.processAlive ? 'awake-idle' : 'asleep'
}

export type SleeperOverlay = {
  now: number
  pinned: ReadonlySet<string>
  onScreen: ReadonlySet<string>
  memoryByPaneKey?: ReadonlyMap<string, number>
}

export function buildSleeperRows(
  sources: readonly SleeperSource[],
  overlay: SleeperOverlay
): SleeperRow[] {
  const seen = new Set<string>()
  const rows: SleeperRow[] = []
  for (const source of sources) {
    if (seen.has(source.id)) {
      continue
    }
    seen.add(source.id)
    const { status: _status, processAlive: _alive, hibernated: _hibernated, ...rest } = source
    const state = deriveSleeperState(source)
    const idle = state === 'awake-idle' || state === 'asleep'
    rows.push({
      ...rest,
      state,
      idleMs: idle ? Math.max(0, overlay.now - source.stateStartedAt) : null,
      lastActivityAt: source.updatedAt,
      pinned: source.kind === 'chat' && overlay.pinned.has(source.id),
      onScreen: overlay.onScreen.has(source.id),
      memoryBytes: overlay.memoryByPaneKey?.get(source.paneKey) ?? null
    })
  }
  return rows
}

export type SleeperFilter = {
  states?: readonly SleeperState[]
  worktreeId?: string | null
  /** Keep only rows idle at least this long. */
  minIdleMs?: number
}

export function filterSleepers(rows: readonly SleeperRow[], filter: SleeperFilter): SleeperRow[] {
  return rows.filter(
    (row) =>
      (!filter.states || filter.states.length === 0 || filter.states.includes(row.state)) &&
      (!filter.worktreeId || row.worktreeId === filter.worktreeId) &&
      (!filter.minIdleMs || (row.idleMs !== null && row.idleMs >= filter.minIdleMs))
  )
}

export type SleeperSortKey = 'idle' | 'activity' | 'workspace' | 'state'

function compareBy(key: SleeperSortKey, a: SleeperRow, b: SleeperRow): number {
  switch (key) {
    case 'idle':
      return (a.idleMs ?? -1) - (b.idleMs ?? -1)
    case 'activity':
      return a.lastActivityAt - b.lastActivityAt
    case 'workspace':
      return a.workspace.localeCompare(b.workspace)
    case 'state':
      return SLEEPER_STATES.indexOf(a.state) - SLEEPER_STATES.indexOf(b.state)
  }
}

/** Stable sort; ties fall back to the title so the list does not jump between polls. */
export function sortSleepers(
  rows: readonly SleeperRow[],
  key: SleeperSortKey,
  descending: boolean
): SleeperRow[] {
  const sign = descending ? -1 : 1
  return [...rows].sort(
    (a, b) =>
      sign * compareBy(key, a, b) || a.title.localeCompare(b.title) || (a.id < b.id ? -1 : 1)
  )
}

/** Whether sleep now can act on a row: a local chat whose provider runs and is not mid-turn. */
export function canSleepNow(row: SleeperRow): boolean {
  return row.kind === 'chat' && row.local && row.state === 'awake-idle'
}

/** "Sleep all idle": every idle local chat that is not pinned, on screen or not. */
export function selectSleepAllIdle(rows: readonly SleeperRow[]): SleeperRow[] {
  return rows.filter((row) => canSleepNow(row) && !row.pinned)
}

/** "Sleep everything except visible": the same, minus chats on screen now. */
export function selectSleepExceptVisible(rows: readonly SleeperRow[]): SleeperRow[] {
  return selectSleepAllIdle(rows).filter((row) => !row.onScreen)
}

export type SleeperLookup =
  | { ok: true; row: SleeperRow }
  | { ok: false; error: 'not-found' | 'ambiguous'; matches: SleeperRow[] }

/** An exact id, else a unique id prefix (so `orca sleepers` users can type the first characters). */
export function resolveSleeper(rows: readonly SleeperRow[], query: string): SleeperLookup {
  const exact = rows.find((row) => row.id === query)
  if (exact) {
    return { ok: true, row: exact }
  }
  const matches = query.length > 0 ? rows.filter((row) => row.id.startsWith(query)) : []
  if (matches.length === 1) {
    return { ok: true, row: matches[0] }
  }
  return { ok: false, error: matches.length === 0 ? 'not-found' : 'ambiguous', matches }
}

/** Most pinned chats kept; a hand-edited list past it is cut. */
export const FORK_SLEEPERS_MAX_PINNED = 500

/** Distinct nonempty session ids, at most FORK_SLEEPERS_MAX_PINNED; anything else is dropped. */
export function normalizeForkSleepersPinned(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  const kept = new Set<string>()
  for (const id of value) {
    if (kept.size >= FORK_SLEEPERS_MAX_PINNED) {
      break
    }
    if (typeof id === 'string' && id.length > 0 && id.length <= 512) {
      kept.add(id)
    }
  }
  return [...kept]
}

/** The pin list of any settings object; a store type without fork keys still reads. */
export function readForkSleepersPinned(settings: unknown): string[] {
  if (typeof settings !== 'object' || settings === null || !('forkSleepersPinned' in settings)) {
    return []
  }
  return normalizeForkSleepersPinned(Reflect.get(settings, 'forkSleepersPinned'))
}

export function withForkSleeperPinned(
  settings: unknown,
  sessionId: string,
  pinned: boolean
): Pick<ForkGlobalSettings, 'forkSleepersPinned'> {
  const list = readForkSleepersPinned(settings).filter((id) => id !== sessionId)
  return { forkSleepersPinned: normalizeForkSleepersPinned(pinned ? [...list, sessionId] : list) }
}
