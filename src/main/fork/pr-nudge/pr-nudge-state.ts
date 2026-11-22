// PR nudges (FORK.md, BAD-680): what they remember per pull request across restarts, in
// `fork-pr-nudge.json` in the app's data folder (mode 0600), written atomically. A missing or
// unreadable file is an empty state; a row this build did not write is dropped. This is what keeps
// a restart from sending the same comment or rebase request twice.
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getAppEnvironment } from '../../../shared/app-lifecycle/app-environment'
import { parsePrBabysitKey } from '../../../shared/fork/pr-babysit'
import {
  PR_NUDGE_MAX_SEEN,
  newPrNudgeEntry,
  type PrNudgeEntry,
  type PrNudgePhase,
  type PrNudgeReason
} from '../../../shared/fork/pr-nudge'

export const PR_NUDGE_STATE_FILE_NAME = 'fork-pr-nudge.json'
const VERSION = 1
const MAX_ENTRIES = 500

export type PrNudgeState = { version: typeof VERSION; entries: Record<string, PrNudgeEntry> }

export function emptyPrNudgeState(): PrNudgeState {
  return { version: VERSION, entries: {} }
}

export function prNudgeStatePath(): string {
  return join(getAppEnvironment().getPath('userData'), PR_NUDGE_STATE_FILE_NAME)
}

const PHASES: readonly string[] = ['ok', 'stuck', 'stopped']
const REASONS: readonly string[] = ['comments-unsent', 'conflict-unsent', 'conflict-cap', 'no-chat']

function epoch(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function strings(value: unknown, max: number): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string' && item.length <= 80)
        .slice(-max)
    : []
}

function parseEntry(prKey: string, value: unknown): PrNudgeEntry | null {
  if (typeof value !== 'object' || value === null || !parsePrBabysitKey(prKey)) {
    return null
  }
  const row = value as Record<string, unknown>
  const updatedAt = epoch(row.updatedAt)
  if (typeof row.phase !== 'string' || !PHASES.includes(row.phase) || updatedAt === null) {
    return null
  }
  const attempts: Record<string, number> = {}
  if (typeof row.attempts === 'object' && row.attempts !== null) {
    for (const [key, count] of Object.entries(row.attempts).slice(0, 50)) {
      if (typeof count === 'number' && Number.isInteger(count) && count >= 0 && count <= 100) {
        attempts[key.slice(0, 80)] = count
      }
    }
  }
  const rounds = epoch(row.conflictRounds)
  return {
    ...newPrNudgeEntry(prKey.toLowerCase(), updatedAt),
    chatId: typeof row.chatId === 'string' && row.chatId.length <= 512 ? row.chatId : null,
    phase: row.phase as PrNudgePhase,
    reason:
      typeof row.reason === 'string' && REASONS.includes(row.reason)
        ? (row.reason as PrNudgeReason)
        : null,
    baselined: row.baselined === true,
    seen: strings(row.seen, PR_NUDGE_MAX_SEEN),
    conflictHeads: strings(row.conflictHeads, 50),
    conflictRounds: rounds === null ? 0 : Math.min(Math.floor(rounds), 100),
    attempts,
    lastCommentReadAt: epoch(row.lastCommentReadAt) ?? 0,
    lastAttemptAt: epoch(row.lastAttemptAt) ?? 0,
    stuckSince: epoch(row.stuckSince)
  }
}

export function parsePrNudgeState(raw: string): PrNudgeState {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return emptyPrNudgeState()
  }
  const entries =
    typeof data === 'object' && data !== null && 'entries' in data ? data.entries : null
  const state = emptyPrNudgeState()
  if (typeof entries !== 'object' || entries === null) {
    return state
  }
  for (const [prKey, value] of Object.entries(entries).slice(0, MAX_ENTRIES)) {
    const entry = parseEntry(prKey, value)
    if (entry) {
      state.entries[entry.prKey] = entry
    }
  }
  return state
}

export async function loadPrNudgeState(path = prNudgeStatePath()): Promise<PrNudgeState> {
  try {
    return parsePrNudgeState(await readFile(path, 'utf8'))
  } catch {
    return emptyPrNudgeState()
  }
}

export async function savePrNudgeState(
  state: PrNudgeState,
  path = prNudgeStatePath()
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
    await rename(temp, path)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}

const DAY_MS = 24 * 60 * 60_000

/** Drops rows nobody needs: any row idle for 30 days (the watcher itself ends after 14). */
export function prunePrNudgeState(state: PrNudgeState, nowMs: number): void {
  for (const [prKey, entry] of Object.entries(state.entries)) {
    if (nowMs - entry.updatedAt > 30 * DAY_MS) {
      delete state.entries[prKey]
    }
  }
}
