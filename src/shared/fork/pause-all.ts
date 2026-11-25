// Pause all (BAD-685, FORK.md "Pause all"): one persisted switch that stops every unattended
// feature from starting new work. Running turns finish. Pure parts shared by the host, the CLI,
// the renderer and the tests.
import { z } from 'zod'

export type ForkPauseAllSettings = {
  /** Fork pause all (BAD-685): when true, `orca pause-all` also pauses every paired server that is online; false pauses this host only. Unset is true. */
  forkPauseAllPairedServers?: boolean
}

/** What a gate tells the person when it skips work, and what run history records. */
export const PAUSE_ALL_REASON_PREFIX = 'Paused by pause-all'

export type ForkPauseAllState = {
  engaged: boolean
  /** Epoch ms the switch was engaged; null when it is off. */
  since: number | null
  /** Who engaged it: 'cli', 'app', 'paired' (another host asked) or 'unreadable' (see corrupt). */
  by: string | null
  note: string | null
  /** The state file exists but cannot be read or parsed: counts as engaged (fail closed). */
  corrupt: boolean
}

export const PAUSE_ALL_OFF: ForkPauseAllState = {
  engaged: false,
  since: null,
  by: null,
  note: null,
  corrupt: false
}

export const PAUSE_ALL_CORRUPT: ForkPauseAllState = {
  engaged: true,
  since: null,
  by: 'unreadable',
  note: null,
  corrupt: true
}

const PAUSE_ALL_FILE_VERSION = 1

export function serializePauseAll(state: ForkPauseAllState): string {
  return JSON.stringify({
    version: PAUSE_ALL_FILE_VERSION,
    engaged: state.engaged,
    since: state.since,
    by: state.by,
    note: state.note
  })
}

/** Parses the file's text. Anything that is not a version 1 object with a boolean `engaged` is corrupt, which counts as engaged. */
export function parsePauseAll(text: string): ForkPauseAllState {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return PAUSE_ALL_CORRUPT
  }
  if (typeof value !== 'object' || value === null) {
    return PAUSE_ALL_CORRUPT
  }
  const row = value as Record<string, unknown>
  if (row.version !== PAUSE_ALL_FILE_VERSION || typeof row.engaged !== 'boolean') {
    return PAUSE_ALL_CORRUPT
  }
  if (!row.engaged) {
    return PAUSE_ALL_OFF
  }
  const since =
    typeof row.since === 'number' && Number.isFinite(row.since) && row.since >= 0 ? row.since : null
  const by = typeof row.by === 'string' && row.by.length <= 40 ? row.by : null
  const note = typeof row.note === 'string' && row.note.length <= 500 ? row.note : null
  return { engaged: true, since, by, note, corrupt: false }
}

/** The line a gate gives when it skips work, and run history records. */
export function pauseAllRefusal(state: ForkPauseAllState): string {
  const why = state.corrupt ? ' (its state could not be read, so it counts as engaged)' : ''
  return `${PAUSE_ALL_REASON_PREFIX}${why}: nothing unattended starts until \`orca resume-all\`.`
}

export const FORK_PAUSE_ALL_SET_METHOD = 'fork.pauseAll.set'
export const FORK_PAUSE_ALL_STATUS_METHOD = 'fork.pauseAll.status'
/** One paired server's call: bounded so a server stuck connecting never holds the answer. */
export const FORK_PAUSE_ALL_SERVER_TIMEOUT_MS = 8_000

export const ForkPauseAllSetParams = z.object({
  engaged: z.boolean(),
  note: z.string().max(500).optional(),
  /** True when another host relays its own change: this host sets its state and does not fan out again. */
  relayed: z.boolean().optional(),
  /** Change this host only. Unset follows `forkPauseAllPairedServers` (on). */
  localOnly: z.boolean().optional()
})
export type ForkPauseAllSetParams = z.infer<typeof ForkPauseAllSetParams>

export const ForkPauseAllStatusParams = z.object({
  /** Also ask every paired server for its switch. */
  fleet: z.boolean().optional()
})
export type ForkPauseAllStatusParams = z.infer<typeof ForkPauseAllStatusParams>

export type ForkPauseAllHostResult = {
  name: string
  /** applied: the server took the change (or answered a status read). unreachable: no answer in time. refused: it answered with an error or has no pause-all. */
  status: 'applied' | 'unreachable' | 'refused'
  /** The server's own switch, when it answered. */
  engaged?: boolean
  detail?: string
}

export type ForkPauseAllResult = {
  /** This host's own switch after the change. */
  state: ForkPauseAllState
  /** Paired servers asked; empty for a local-only change or a relayed one. */
  hosts: ForkPauseAllHostResult[]
  /** What this host holds for resume-all (BAD-818): unread mail to bots' chats, room hand-offs and
   *  worker launches waiting in the launch queue (absent from an older host). Absent where it could
   *  not be read. */
  held?: { mail: number; handOffs: number; launches?: number }
}

/** The state a server answered with, or null when the answer is not a pause-all result. */
export function parsePauseAllAnswer(answer: unknown): boolean | null {
  if (typeof answer !== 'object' || answer === null) {
    return null
  }
  const state = (answer as { state?: unknown }).state
  if (typeof state !== 'object' || state === null) {
    return null
  }
  const engaged = (state as { engaged?: unknown }).engaged
  return typeof engaged === 'boolean' ? engaged : null
}

/** What the CLI and the status bar print: one line for this host, one per paired server that did not take it. */
export function formatPauseAll(result: ForkPauseAllResult): string {
  const { state } = result
  const lines = [
    state.engaged
      ? `Paused${state.corrupt ? ' (switch unreadable, counts as engaged)' : ''}: schedulers, automations, event triggers, idle-recovery wakes, babysitter and nudge sends, unattended resume, goal steps, worker retries, worker launches, bot looks and tidy-ups, bot room hand-offs, bot mail, connector messages to bots and automatic limit handoffs start nothing. Running turns finish.${state.since ? ` Since ${new Date(state.since).toISOString()}.` : ''}`
      : 'Not paused.'
  ]
  const held = result.held
  const launches = held?.launches ?? 0
  if (held && held.mail + held.handOffs + launches > 0) {
    lines.push(
      `Held for resume-all: ${held.mail} bot mail, ${held.handOffs} room hand-off${held.handOffs === 1 ? '' : 's'}, ${launches} worker launch${launches === 1 ? '' : 'es'} (orca agent queue list).`
    )
  }
  for (const host of result.hosts) {
    lines.push(
      `${host.name}: ${host.status === 'applied' ? (host.engaged ? 'paused' : 'running') : host.status}${host.detail ? ` (${host.detail})` : ''}`
    )
  }
  return lines.join('\n')
}
