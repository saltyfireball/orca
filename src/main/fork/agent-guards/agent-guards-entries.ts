// Agent guards (FORK.md, SLRM-2385): the entries the status line, the Decision inbox and
// `orca guards list` show, built from the engine's records and memory. Pure.
import {
  tightestAgentGuardLimit,
  type AgentGuardEntry,
  type AgentGuardLimit
} from '../../../shared/fork/agent-guards'
import type { AgentGuardRecord, AgentGuardRecords } from './agent-guards-state'

export type AgentGuardMeta = {
  kind: 'chat' | 'terminal'
  agent: string
  title: string
  worktreeId: string | null
}

export type AgentGuardWarned = { since: number; repeats: number; tool: string }

export function roundUsd(value: number): number {
  return Math.round(value * 100) / 100
}

function base(id: string, meta: AgentGuardMeta) {
  return {
    id,
    kind: meta.kind,
    ...(meta.kind === 'chat' ? { sessionId: id } : { paneKey: id }),
    agent: meta.agent,
    title: meta.title,
    worktreeId: meta.worktreeId
  }
}

/** The entry of a paused agent, or null when the record holds no pause. */
export function pausedAgentGuardEntry(
  id: string,
  record: AgentGuardRecord
): AgentGuardEntry | null {
  const pause = record.paused
  if (!pause) {
    return null
  }
  return {
    ...base(id, record),
    state: 'paused',
    reason: pause.reason,
    since: pause.at,
    ...(pause.repeats !== undefined ? { repeats: pause.repeats } : {}),
    ...(pause.tool ? { tool: pause.tool } : {}),
    ...(pause.spentUsd !== undefined ? { spentUsd: pause.spentUsd } : {}),
    ...(pause.capUsd !== undefined ? { capUsd: pause.capUsd } : {}),
    ...(pause.scope ? { scope: pause.scope } : {}),
    ...(pause.notInterrupted ? { notInterrupted: true } : {})
  }
}

export type AgentGuardEntriesInput = {
  records: AgentGuardRecords
  warned: ReadonlyMap<string, AgentGuardWarned>
  meta: ReadonlyMap<string, AgentGuardMeta>
  /** Every cap that covers an agent with its spend, or empty when none does or it has no spend. */
  limits: (id: string) => AgentGuardLimit[]
}

/** Paused and warned agents, then chats with a cap, oldest first within each. */
export function buildAgentGuardEntries(input: AgentGuardEntriesInput): AgentGuardEntry[] {
  const paused: AgentGuardEntry[] = []
  for (const [id, record] of input.records) {
    const entry = pausedAgentGuardEntry(id, record)
    if (entry) {
      paused.push(entry)
    }
  }
  const isPaused = (id: string): boolean => Boolean(input.records.get(id)?.paused)
  const warned: AgentGuardEntry[] = []
  for (const [id, shown] of input.warned) {
    const meta = input.meta.get(id)
    if (meta && !isPaused(id)) {
      warned.push({
        ...base(id, meta),
        state: 'warned',
        reason: 'loop',
        since: shown.since,
        repeats: shown.repeats,
        tool: shown.tool
      })
    }
  }
  const capped: AgentGuardEntry[] = []
  for (const [id, meta] of input.meta) {
    const limits = isPaused(id) ? [] : input.limits(id)
    const tight = tightestAgentGuardLimit(limits)
    if (tight) {
      capped.push({
        ...base(id, meta),
        state: 'capped',
        reason: null,
        since: input.records.get(id)?.at ?? 0,
        capUsd: tight.capUsd,
        spentUsd: tight.spentUsd,
        scope: tight.scope,
        limits
      })
    }
  }
  const bySince = (a: AgentGuardEntry, b: AgentGuardEntry): number => a.since - b.since
  return [...paused.sort(bySince), ...warned.sort(bySince), ...capped.sort(bySince)]
}
