// PR babysitter (FORK.md, SLRM-2386): what it remembers per pull request across restarts, in
// `fork-pr-babysit.json` in the app's data folder (mode 0600), written atomically. A missing or
// unreadable file is an empty state; a row this build did not write is dropped.
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getAppEnvironment } from '../../../shared/app-lifecycle/app-environment'
import {
  parsePrBabysitKey,
  prBabysitPlain,
  type PrBabysitEntry,
  type PrBabysitPhase,
  type PrBabysitReason
} from '../../../shared/fork/pr-babysit'

export const PR_BABYSIT_STATE_FILE_NAME = 'fork-pr-babysit.json'
const VERSION = 1
const MAX_ENTRIES = 500

export type PrBabysitState = { version: typeof VERSION; entries: Record<string, PrBabysitEntry> }

export function emptyPrBabysitState(): PrBabysitState {
  return { version: VERSION, entries: {} }
}

export function prBabysitStatePath(): string {
  return join(getAppEnvironment().getPath('userData'), PR_BABYSIT_STATE_FILE_NAME)
}

const PHASES: readonly string[] = ['watching', 'fixing', 'green', 'merged', 'stuck', 'stopped']
const REASONS: readonly string[] = [
  'cap',
  'no-ci',
  'chat-unavailable',
  'no-chat',
  'merge-blocked',
  'merge-failed'
]

function epoch(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null
}

function parseEntry(prKey: string, value: unknown): PrBabysitEntry | null {
  if (typeof value !== 'object' || value === null || !parsePrBabysitKey(prKey)) {
    return null
  }
  const row = value as Record<string, unknown>
  const updatedAt = epoch(row.updatedAt)
  if (typeof row.phase !== 'string' || !PHASES.includes(row.phase) || updatedAt === null) {
    return null
  }
  const rounds = epoch(row.rounds)
  return {
    prKey: prKey.toLowerCase(),
    source: row.source === 'cli' ? 'cli' : 'repo',
    chatId: text(row.chatId, 512),
    rounds: rounds === null ? 0 : Math.min(Math.floor(rounds), 100),
    phase: row.phase as PrBabysitPhase,
    reason:
      typeof row.reason === 'string' && REASONS.includes(row.reason)
        ? (row.reason as PrBabysitReason)
        : null,
    detail: typeof row.detail === 'string' ? prBabysitPlain(row.detail) : '',
    lastEvent: text(row.lastEvent, 120),
    headSha: text(row.headSha, 64),
    fixSentAt: epoch(row.fixSentAt),
    stuckSince: epoch(row.stuckSince),
    updatedAt
  }
}

export function parsePrBabysitState(raw: string): PrBabysitState {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return emptyPrBabysitState()
  }
  const entries =
    typeof data === 'object' && data !== null && 'entries' in data ? data.entries : null
  const state = emptyPrBabysitState()
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

export async function loadPrBabysitState(path = prBabysitStatePath()): Promise<PrBabysitState> {
  try {
    return parsePrBabysitState(await readFile(path, 'utf8'))
  } catch {
    return emptyPrBabysitState()
  }
}

export async function savePrBabysitState(
  state: PrBabysitState,
  path = prBabysitStatePath()
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

/** Drops what nobody needs: merged or stopped rows after 2 days, any row after 30 idle days. */
export function prunePrBabysitState(state: PrBabysitState, nowMs: number): void {
  for (const [prKey, entry] of Object.entries(state.entries)) {
    const age = nowMs - entry.updatedAt
    const done = entry.phase === 'merged' || (entry.phase === 'stopped' && entry.source === 'cli')
    if (age > 30 * DAY_MS || (done && age > 2 * DAY_MS)) {
      delete state.entries[prKey]
    }
  }
}
