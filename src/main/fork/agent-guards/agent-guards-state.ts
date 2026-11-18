// Agent guards (FORK.md, SLRM-2385): what is kept per guarded agent across restarts, in
// `fork-agent-guards.json` in the data folder (mode 0600): a pause and why, a chat's own spend cap
// and the spend a resume set aside. The loop watch itself is not kept: a restart starts a new
// episode. An unreadable file starts empty; a malformed entry is dropped.
import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  agentGuardLabel,
  normalizeAgentGuardCap,
  type AgentGuardReason
} from '../../../shared/fork/agent-guards'

export const AGENT_GUARDS_FILE = 'fork-agent-guards.json'
const MAX_AGENTS = 2000
const MAX_ID = 600

export type AgentGuardPause = {
  reason: AgentGuardReason
  at: number
  repeats?: number
  tool?: string
  spentUsd?: number
  capUsd?: number
  notInterrupted?: boolean
}

export type AgentGuardRecord = {
  kind: 'chat' | 'terminal'
  agent: string
  title: string
  worktreeId: string | null
  paused?: AgentGuardPause
  /** The chat's own cap (`orca guards cap`), over the default. */
  capUsd?: number
  /** Spend the last resume set aside: the cap counts from there. */
  baselineUsd?: number
  /** Epoch ms the record last changed; records gone quiet for 30 days are dropped. */
  at: number
}

export type AgentGuardRecords = Map<string, AgentGuardRecord>

export const AGENT_GUARD_RECORD_TTL_MS = 30 * 24 * 60 * 60_000

export function agentGuardsPath(stateDirectory: string): string {
  return join(stateDirectory, AGENT_GUARDS_FILE)
}

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined

function readPause(value: unknown): AgentGuardPause | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const raw = value as Record<string, unknown>
  if ((raw.reason !== 'loop' && raw.reason !== 'spend') || num(raw.at) === undefined) {
    return undefined
  }
  const pause: AgentGuardPause = { reason: raw.reason, at: num(raw.at) ?? 0 }
  if (num(raw.repeats) !== undefined) {
    pause.repeats = Math.round(num(raw.repeats) ?? 0)
  }
  if (typeof raw.tool === 'string') {
    pause.tool = agentGuardLabel(raw.tool)
  }
  if (num(raw.spentUsd) !== undefined) {
    pause.spentUsd = num(raw.spentUsd)
  }
  if (num(raw.capUsd) !== undefined) {
    pause.capUsd = num(raw.capUsd)
  }
  if (raw.notInterrupted === true) {
    pause.notInterrupted = true
  }
  return pause
}

export function parseAgentGuardRecords(text: string): AgentGuardRecords {
  const records: AgentGuardRecords = new Map()
  const parsed: unknown = JSON.parse(text)
  const agents =
    typeof parsed === 'object' && parsed !== null && 'agents' in parsed ? parsed.agents : null
  if (typeof agents !== 'object' || agents === null || Array.isArray(agents)) {
    return records
  }
  for (const [id, value] of Object.entries(agents)) {
    if (records.size >= MAX_AGENTS) {
      break
    }
    if (!id || id.length > MAX_ID || typeof value !== 'object' || value === null) {
      continue
    }
    const raw = value as Record<string, unknown>
    if (raw.kind !== 'chat' && raw.kind !== 'terminal') {
      continue
    }
    const record: AgentGuardRecord = {
      kind: raw.kind,
      agent: typeof raw.agent === 'string' ? agentGuardLabel(raw.agent, 40) : '',
      title: typeof raw.title === 'string' ? agentGuardLabel(raw.title) : '',
      worktreeId:
        typeof raw.worktreeId === 'string' && raw.worktreeId.length <= MAX_ID
          ? raw.worktreeId
          : null,
      at: num(raw.at) ?? 0
    }
    const paused = readPause(raw.paused)
    if (paused) {
      record.paused = paused
    }
    const cap = normalizeAgentGuardCap(raw.capUsd)
    if (cap !== null) {
      record.capUsd = cap
    }
    if (num(raw.baselineUsd) !== undefined) {
      record.baselineUsd = num(raw.baselineUsd)
    }
    records.set(id, record)
  }
  return records
}

export async function readAgentGuardRecords(path: string): Promise<AgentGuardRecords> {
  try {
    return parseAgentGuardRecords(await readFile(path, 'utf8'))
  } catch {
    return new Map()
  }
}

/** Drops records with nothing left to keep, or quiet for longer than the TTL. */
export function pruneAgentGuardRecords(records: AgentGuardRecords, now: number): boolean {
  let changed = false
  for (const [id, record] of records) {
    const empty = !record.paused && record.capUsd === undefined && record.baselineUsd === undefined
    if (empty || now - record.at > AGENT_GUARD_RECORD_TTL_MS) {
      records.delete(id)
      changed = true
    }
  }
  return changed
}

export async function writeAgentGuardRecords(
  path: string,
  records: AgentGuardRecords
): Promise<void> {
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(
      temp,
      `${JSON.stringify({ version: 1, agents: Object.fromEntries(records) }, null, 2)}\n`,
      { mode: 0o600, flag: 'wx' }
    )
    await rename(temp, path)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
}
