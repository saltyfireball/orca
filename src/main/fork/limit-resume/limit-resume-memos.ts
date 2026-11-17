// Limit resume (FORK.md, SLRM-2309): what is kept per terminal agent across restarts, in
// `fork-limit-resume.json` in the data folder (mode 0600). A memo counts the automatic resumes in
// a row and names the stop each one answered, so the same words on screen are never answered
// twice and a crash loop stops at the cap. An unreadable file starts empty.
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export const LIMIT_RESUME_FILE = 'fork-limit-resume.json'

/** More than any data folder holds; a bigger file is not ours to trust. */
const MAX_MEMOS = 2000
const MAX_TEXT = 1000

export type LimitResumeMemo = {
  /** Automatic resumes in a row; dropped once a turn ends without a limit. */
  tries: number
  /** The stop the last resume (or cancel) answered: its line and how often it was on screen. */
  answeredLine?: string
  answeredOccurrences?: number
  /** True when the answer was a cancel, so the stop shows as cancelled. */
  cancelled?: boolean
  /** Epoch ms of the last resume sent. */
  resumedAt?: number
  /** Epoch ms the memo last changed; old memos of panes gone are dropped. */
  at: number
}

export type LimitResumeMemos = Map<string, LimitResumeMemo>

export function limitResumeMemosPath(stateDirectory: string): string {
  return join(stateDirectory, LIMIT_RESUME_FILE)
}

const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined

export function parseLimitResumeMemos(text: string): LimitResumeMemos {
  const memos: LimitResumeMemos = new Map()
  const parsed: unknown = JSON.parse(text)
  const panes =
    typeof parsed === 'object' && parsed !== null && 'panes' in parsed ? parsed.panes : null
  if (typeof panes !== 'object' || panes === null || Array.isArray(panes)) {
    return memos
  }
  for (const [paneKey, value] of Object.entries(panes)) {
    if (memos.size >= MAX_MEMOS) {
      break
    }
    if (!paneKey || paneKey.length > 600 || typeof value !== 'object' || value === null) {
      continue
    }
    const raw = value as Record<string, unknown>
    const line =
      typeof raw.answeredLine === 'string' ? raw.answeredLine.slice(0, MAX_TEXT) : undefined
    memos.set(paneKey, {
      tries: count(raw.tries) ?? 0,
      ...(line !== undefined ? { answeredLine: line } : {}),
      ...(count(raw.answeredOccurrences) !== undefined
        ? { answeredOccurrences: count(raw.answeredOccurrences) }
        : {}),
      ...(raw.cancelled === true ? { cancelled: true } : {}),
      ...(count(raw.resumedAt) !== undefined ? { resumedAt: count(raw.resumedAt) } : {}),
      at: count(raw.at) ?? 0
    })
  }
  return memos
}

export async function readLimitResumeMemos(path: string): Promise<LimitResumeMemos> {
  try {
    return parseLimitResumeMemos(await readFile(path, 'utf8'))
  } catch {
    return new Map()
  }
}

export async function writeLimitResumeMemos(path: string, memos: LimitResumeMemos): Promise<void> {
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(
      temp,
      `${JSON.stringify({ version: 1, panes: Object.fromEntries(memos) }, null, 2)}\n`,
      { mode: 0o600, flag: 'wx' }
    )
    await rename(temp, path)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
}
