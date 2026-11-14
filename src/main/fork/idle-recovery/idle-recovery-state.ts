// Idle recovery (FORK.md), item D: what is remembered per chat between sweeps and restarts.
// Contract: load returns the saved state, or an empty one when the file is missing or
// unreadable; save writes it atomically with async file calls. Rows of chats that are gone are
// dropped by the sweep, not here.
// The file is `fork-idle-recovery.json` in the app's user data folder. Each row keeps the wake
// count of its chat, so the wake cap holds across a restart.
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getAppEnvironment } from '../../../shared/app-environment'
import {
  IDLE_RECOVERY_STATE_VERSION,
  type IdleRecoveryChatState,
  type IdleRecoveryPersistedState,
  type IdleRecoveryVerdictKind
} from '../../../shared/fork/idle-recovery'
import type { ForkIdleRecoveryInboxItem } from '../../../shared/fork/idle-recovery-wire'

export const IDLE_RECOVERY_STATE_FILE_NAME = 'fork-idle-recovery.json'

/** A saved row. The same as the shared type; the name is kept for this folder's readers. */
export type IdleRecoveryStoredChat = IdleRecoveryChatState

export type IdleRecoveryStoredState = IdleRecoveryPersistedState

export function emptyIdleRecoveryState(): IdleRecoveryStoredState {
  return { version: IDLE_RECOVERY_STATE_VERSION, chats: {} }
}

export function idleRecoveryStatePath(): string {
  return join(getAppEnvironment().getPath('userData'), IDLE_RECOVERY_STATE_FILE_NAME)
}

const VERDICTS: readonly string[] = ['finished', 'waiting_user', 'stalled']

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function epoch(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/** One row as saved, or null when it is not a row this build wrote. */
function parseRow(value: unknown): IdleRecoveryStoredChat | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const row = value as Record<string, unknown>
  const since = epoch(row.since)
  const wakes = epoch(row.wakes)
  if (
    typeof row.fingerprint !== 'string' ||
    typeof row.verdict !== 'string' ||
    !VERDICTS.includes(row.verdict) ||
    since === null ||
    wakes === null
  ) {
    return null
  }
  return {
    fingerprint: row.fingerprint,
    verdict: row.verdict as IdleRecoveryVerdictKind,
    question: text(row.question),
    since,
    wakes: Math.floor(wakes),
    wakeAt: epoch(row.wakeAt),
    paused: row.paused === true,
    reason: text(row.reason),
    nextStep: text(row.nextStep),
    idleSince: epoch(row.idleSince) ?? 0,
    seenAt: epoch(row.seenAt) ?? since,
    listed: row.listed === true,
    kind: row.kind === 'terminal' ? 'terminal' : 'chat',
    agent: text(row.agent),
    title: text(row.title),
    workspace: text(row.workspace),
    worktreeId: typeof row.worktreeId === 'string' ? row.worktreeId : null
  }
}

export function parseIdleRecoveryState(raw: string): IdleRecoveryStoredState {
  const state = emptyIdleRecoveryState()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return state
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return state
  }
  const { version, chats } = parsed as { version?: unknown; chats?: unknown }
  if (version !== IDLE_RECOVERY_STATE_VERSION || typeof chats !== 'object' || chats === null) {
    return state
  }
  for (const [chatId, value] of Object.entries(chats)) {
    const row = parseRow(value)
    if (row && chatId) {
      state.chats[chatId] = row
    }
  }
  return state
}

/**
 * The same state object with every row checked the way a saved row is when it is loaded: a field
 * of the wrong type gets its empty value, and rows that are not rows are dropped.
 */
export function asIdleRecoveryStoredState(
  state: IdleRecoveryPersistedState
): IdleRecoveryStoredState {
  const { chats } = state
  for (const chatId of Object.keys(chats)) {
    const row = parseRow(chats[chatId])
    if (row) {
      chats[chatId] = row
    } else {
      delete chats[chatId]
    }
  }
  return state
}

export async function loadIdleRecoveryState(
  path: string = idleRecoveryStatePath()
): Promise<IdleRecoveryStoredState> {
  try {
    return parseIdleRecoveryState(await readFile(path, 'utf8'))
  } catch {
    // Missing or unreadable: start empty rather than fail the sweep.
    return emptyIdleRecoveryState()
  }
}

export async function saveIdleRecoveryState(
  state: IdleRecoveryPersistedState,
  path: string = idleRecoveryStatePath()
): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  try {
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 })
    // A rename within one folder replaces the file in one step, so a reader never sees half of it.
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

/** The Decision inbox: listed chats that wait on the user or are stalled, oldest first. */
export function listIdleRecoveryInboxItems(
  state: IdleRecoveryStoredState
): ForkIdleRecoveryInboxItem[] {
  const items: ForkIdleRecoveryInboxItem[] = []
  for (const [chatId, row] of Object.entries(state.chats)) {
    if (!row.listed || row.verdict === 'finished') {
      continue
    }
    items.push({
      chatId,
      kind: row.kind,
      agent: row.agent,
      title: row.title,
      workspace: row.workspace,
      worktreeId: row.worktreeId,
      verdict: row.verdict,
      question: row.question,
      reason: row.reason,
      since: row.since,
      wakes: row.wakes,
      wakeAt: row.verdict === 'stalled' ? row.wakeAt : null,
      paused: row.paused
    })
  }
  return items.sort((a, b) => a.since - b.since || a.chatId.localeCompare(b.chatId))
}
