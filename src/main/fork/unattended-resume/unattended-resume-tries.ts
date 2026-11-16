// Unattended resume (FORK.md, SLRM-2268): how many automatic continuations each chat has had in
// a row, kept in the app's data folder so a crash loop stops at the cap. A count goes up before
// its continuation is sent (a crash during the send still counts) and is dropped once a start
// finds no interrupted turn for that chat (it got through a whole run of the server). An
// unreadable file starts empty rather than failing start-up.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomically } from '../../filesystem/atomic-file-publication'

export const UNATTENDED_RESUME_TRIES_FILE = 'fork-unattended-resume.json'

/** More than any data folder holds; a bigger file is not ours to trust. */
const MAX_ENTRIES = 5000
const MAX_ID_LENGTH = 512

export type UnattendedResumeTryEntry = { tries: number; lastTryAt: number }
export type UnattendedResumeTries = Map<string, UnattendedResumeTryEntry>

export function unattendedResumeTriesPath(stateDirectory: string): string {
  return join(stateDirectory, UNATTENDED_RESUME_TRIES_FILE)
}

export function parseUnattendedResumeTries(text: string): UnattendedResumeTries {
  const tries: UnattendedResumeTries = new Map()
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || !('sessions' in parsed)) {
    return tries
  }
  const sessions = parsed.sessions
  if (typeof sessions !== 'object' || sessions === null || Array.isArray(sessions)) {
    return tries
  }
  for (const [sessionId, value] of Object.entries(sessions)) {
    if (tries.size >= MAX_ENTRIES) {
      break
    }
    if (sessionId.length === 0 || sessionId.length > MAX_ID_LENGTH) {
      continue
    }
    if (typeof value !== 'object' || value === null) {
      continue
    }
    const count: unknown = (value as Record<string, unknown>).tries
    const at: unknown = (value as Record<string, unknown>).lastTryAt
    if (typeof count === 'number' && Number.isInteger(count) && count > 0) {
      tries.set(sessionId, {
        tries: count,
        lastTryAt: typeof at === 'number' && Number.isFinite(at) ? at : 0
      })
    }
  }
  return tries
}

export async function readUnattendedResumeTries(path: string): Promise<UnattendedResumeTries> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[fork-unattended-resume] Could not read the tries file; starting empty:', error)
    }
    return new Map()
  }
  try {
    return parseUnattendedResumeTries(text)
  } catch (error) {
    console.warn('[fork-unattended-resume] Could not read the tries file; starting empty:', error)
    return new Map()
  }
}

export function writeUnattendedResumeTries(path: string, tries: UnattendedResumeTries): void {
  const sessions = Object.fromEntries(tries)
  writeFileAtomically(path, `${JSON.stringify({ version: 1, sessions }, null, 2)}\n`, {
    mode: 0o600
  })
}
