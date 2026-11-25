// Goal loop (BAD-682, FORK.md): the goals set with `orca goal set`, kept in
// `fork-goal-loop.json` in the data folder (mode 0600) so a restart keeps them. An unreadable file
// starts empty. Stopped goals are kept for a day so `orca goal list` can say why they stopped.
import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { GoalRecord, GoalStopReason, GoalUntil } from '../../../shared/fork/goal-loop'

export const GOAL_LOOP_FILE = 'fork-goal-loop.json'
const MAX_GOALS = 500
const STOPPED_KEEP_MS = 24 * 60 * 60 * 1000
const REASONS: readonly GoalStopReason[] = [
  'met',
  'max-rounds',
  'budget',
  'no-progress',
  'unreachable',
  'cleared',
  'gone',
  'agent-lost'
]

export function goalLoopPath(stateDirectory: string): string {
  return join(stateDirectory, GOAL_LOOP_FILE)
}

function str(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function readUntil(value: unknown): GoalUntil | null {
  const raw = value as {
    kind?: unknown
    command?: unknown
    criteria?: unknown
  } | null
  if (raw?.kind === 'cmd' && typeof raw.command === 'string' && raw.command.trim()) {
    return { kind: 'cmd', command: raw.command }
  }
  if (raw?.kind === 'judge' && typeof raw.criteria === 'string' && raw.criteria.trim()) {
    return { kind: 'judge', criteria: raw.criteria }
  }
  return null
}

function readGoal(value: unknown): GoalRecord | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const raw = value as Record<string, unknown>
  const until = readUntil(raw.until)
  const id = str(raw.id, 600)
  if (!until || !id) {
    return null
  }
  const stop = raw.stop as { reason?: unknown; text?: unknown; at?: unknown } | undefined
  const reason = REASONS.find((entry) => entry === stop?.reason)
  return {
    id,
    kind: raw.kind === 'terminal' ? 'terminal' : 'chat',
    agent: str(raw.agent, 100),
    title: str(raw.title, 300),
    worktreeId: typeof raw.worktreeId === 'string' ? raw.worktreeId : null,
    until,
    maxRounds: num(raw.maxRounds),
    budgetUsd: num(raw.budgetUsd),
    baselineUsd: num(raw.baselineUsd),
    createdAt: num(raw.createdAt),
    status: raw.status === 'stopped' ? 'stopped' : 'active',
    rounds: num(raw.rounds),
    lastSignature: typeof raw.lastSignature === 'string' ? raw.lastSignature : null,
    repeats: num(raw.repeats),
    handledIdleSince: typeof raw.handledIdleSince === 'number' ? raw.handledIdleSince : null,
    sendFailures: num(raw.sendFailures),
    missing: 0,
    ...(typeof raw.closedAt === 'number' ? { closedAt: raw.closedAt } : {}),
    lastFailure: str(raw.lastFailure, 4000),
    ...(reason ? { stop: { reason, text: str(stop?.text, 2000), at: num(stop?.at) } } : {})
  }
}

export function parseGoals(text: string): Map<string, GoalRecord> {
  const goals = new Map<string, GoalRecord>()
  const parsed: unknown = JSON.parse(text)
  const list =
    typeof parsed === 'object' && parsed !== null && 'goals' in parsed ? parsed.goals : null
  if (!Array.isArray(list)) {
    return goals
  }
  for (const entry of list) {
    const goal = readGoal(entry)
    if (goal && goals.size < MAX_GOALS) {
      goals.set(goal.id, goal)
    }
  }
  return goals
}

export async function readGoals(path: string): Promise<Map<string, GoalRecord>> {
  try {
    return parseGoals(await readFile(path, 'utf8'))
  } catch {
    return new Map()
  }
}

export async function writeGoals(path: string, goals: Map<string, GoalRecord>): Promise<void> {
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(
      temp,
      `${JSON.stringify({ version: 1, goals: [...goals.values()] }, null, 2)}\n`,
      {
        mode: 0o600,
        flag: 'wx'
      }
    )
    await rename(temp, path)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
}

/** Drops stopped goals older than a day. */
export function pruneGoals(goals: Map<string, GoalRecord>, now: number): void {
  for (const [id, goal] of goals) {
    if (goal.status === 'stopped' && now - (goal.stop?.at ?? 0) > STOPPED_KEEP_MS) {
      goals.delete(id)
    }
  }
}
