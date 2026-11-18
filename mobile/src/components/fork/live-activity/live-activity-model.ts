// Blackfish (SLRM-2387): what the iOS Live Activity and the agents widget show. Pure: the hook
// folds every paired server's agents into the rows both surfaces draw.
import {
  agentStatusGroup,
  everyRow,
  hostAgents,
  type AgentListInput,
  type AgentListRow
} from '../../../agents/agent-list-rows'

export type LiveAgentState = 'needs-you' | 'failed' | 'working' | 'done'

/** One agent as the Lock Screen shows it. Times are epoch milliseconds. */
export type LiveAgentRow = Readonly<{
  /** `hostId:paneKey`, the agent list's own row key. */
  id: string
  hostId: string
  paneKey: string
  title: string
  host: string
  workspace: string
  state: LiveAgentState
  /** When the current state began: the turn's start, or when it finished. */
  since: number
  /** A finished row leaves the Lock Screen at this time. */
  expiresAt?: number
}>

/** The rows the phone last knew, kept across launches. */
export type LiveAgentMemory = Readonly<{ rows: readonly LiveAgentRow[] }>

export const EMPTY_LIVE_AGENT_MEMORY: LiveAgentMemory = { rows: [] }

/** The JSON both native surfaces decode (BlackfishAgentsSnapshot in Swift). */
export type LiveAgentSnapshot = Readonly<{
  rows: readonly Omit<LiveAgentRow, 'hostId' | 'paneKey'>[]
  working: number
  needsYou: number
  done: number
  updatedAt: number
}>

const STATE_ORDER: Record<LiveAgentState, number> = {
  'needs-you': 0,
  failed: 1,
  working: 2,
  done: 3
}

// Long names would push the content state past ActivityKit's 4 KB cap.
const MAX_TEXT = 60

function clip(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > MAX_TEXT ? `${trimmed.slice(0, MAX_TEXT - 3)}...` : trimmed
}

/** The desktop's status, cut to the four states the Lock Screen draws; idle agents are not shown. */
export function liveAgentState(row: AgentListRow): LiveAgentState | null {
  if (row.dotState === 'failed') {
    return 'failed'
  }
  const group = agentStatusGroup(row.dotState)
  return group === 'idle' ? null : group
}

function isFinished(state: LiveAgentState): boolean {
  return state === 'done' || state === 'failed'
}

function finishedAt(previous: LiveAgentRow | undefined, row: AgentListRow, now: number): number {
  if (previous && isFinished(previous.state)) {
    return previous.since
  }
  // Seen running a moment ago: it finished now. First seen finished: the desktop's own time.
  return previous ? now : Math.min(row.timeAt || now, now)
}

function stillShown(row: LiveAgentRow, now: number): boolean {
  return row.expiresAt === undefined || row.expiresAt > now
}

/**
 * Folds one read of every paired server into what the phone remembers. A server read live this
 * time replaces its rows; a server that is not connected keeps what it last showed, since the
 * Lock Screen has nothing newer. Finished rows stay `keepFinishedMs`, then drop.
 */
export function foldLiveAgents(
  memory: LiveAgentMemory,
  input: AgentListInput,
  hostNames: Readonly<Record<string, string>>,
  keepFinishedMs: number
): LiveAgentMemory {
  const now = input.now
  const previousById = new Map(memory.rows.map((row) => [row.id, row]))
  const pairedHosts = new Set(input.hosts.map((host) => host.id))
  const liveHosts = new Set<string>()
  const rows: LiveAgentRow[] = []
  for (const host of input.hosts) {
    const agents = hostAgents(input, host.id)
    if (!agents.live) {
      continue
    }
    liveHosts.add(host.id)
    for (const row of everyRow(agents.roots)) {
      const previous = previousById.get(row.key)
      const state = liveAgentState(row)
      // An agent seen working that now reads idle finished between reads.
      const resolved: LiveAgentState | null =
        state ?? (previous && !isFinished(previous.state) ? 'done' : null)
      if (!resolved) {
        continue
      }
      const finished = isFinished(resolved)
      const since = finished ? finishedAt(previous, row, now) : row.timeAt || now
      rows.push({
        id: row.key,
        hostId: host.id,
        paneKey: row.entry.agent.paneKey,
        title: clip(row.title),
        host: clip(hostNames[host.id] ?? host.id),
        workspace: clip(row.entry.workspaceName),
        state: resolved,
        since,
        ...(finished ? { expiresAt: since + keepFinishedMs } : {})
      })
    }
    // A finished row the desktop no longer lists (read, cleared) still keeps its minutes.
    for (const previous of memory.rows) {
      if (
        previous.hostId === host.id &&
        isFinished(previous.state) &&
        !rows.some((row) => row.id === previous.id)
      ) {
        rows.push(previous)
      }
    }
  }
  for (const previous of memory.rows) {
    if (pairedHosts.has(previous.hostId) && !liveHosts.has(previous.hostId)) {
      rows.push(previous)
    }
  }
  return { rows: rows.filter((row) => stillShown(row, now)).sort(byStateThenRecent) }
}

function byStateThenRecent(a: LiveAgentRow, b: LiveAgentRow): number {
  return STATE_ORDER[a.state] - STATE_ORDER[b.state] || b.since - a.since
}

/** The next time a finished row leaves, so the caller can wake then. */
export function nextLiveAgentExpiry(memory: LiveAgentMemory): number | null {
  const times = memory.rows.flatMap((row) => (row.expiresAt === undefined ? [] : [row.expiresAt]))
  return times.length > 0 ? Math.min(...times) : null
}

/** The native snapshot: counts over every row, the first `maxRows` rows listed. */
export function liveAgentSnapshot(
  memory: LiveAgentMemory,
  maxRows: number,
  updatedAt: number
): LiveAgentSnapshot {
  const count = (match: (state: LiveAgentState) => boolean) =>
    memory.rows.filter((row) => match(row.state)).length
  return {
    rows: memory.rows
      .slice(0, maxRows)
      .map(({ hostId: _hostId, paneKey: _paneKey, ...row }) => row),
    working: count((state) => state === 'working'),
    needsYou: count((state) => state === 'needs-you' || state === 'failed'),
    done: count((state) => state === 'done'),
    updatedAt
  }
}

/** Equal content ignoring when it was taken, so an unchanged list sends nothing to iOS. */
export function sameLiveAgentContent(a: LiveAgentSnapshot | null, b: LiveAgentSnapshot): boolean {
  return (
    a !== null && JSON.stringify({ ...a, updatedAt: 0 }) === JSON.stringify({ ...b, updatedAt: 0 })
  )
}

/** Reads a stored memory, dropping anything malformed. */
export function parseLiveAgentMemory(raw: string | null): LiveAgentMemory {
  if (!raw) {
    return EMPTY_LIVE_AGENT_MEMORY
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    const rows =
      parsed && typeof parsed === 'object' && 'rows' in parsed && Array.isArray(parsed.rows)
        ? parsed.rows
        : []
    return { rows: rows.filter(isLiveAgentRow) }
  } catch {
    return EMPTY_LIVE_AGENT_MEMORY
  }
}

function isLiveAgentRow(value: unknown): value is LiveAgentRow {
  if (!value || typeof value !== 'object') {
    return false
  }
  const row = value as Record<string, unknown>
  return (
    ['id', 'hostId', 'paneKey', 'title', 'host', 'workspace'].every(
      (key) => typeof row[key] === 'string'
    ) &&
    typeof row.state === 'string' &&
    row.state in STATE_ORDER &&
    typeof row.since === 'number' &&
    (row.expiresAt === undefined || typeof row.expiresAt === 'number')
  )
}
