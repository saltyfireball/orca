// Command guards (FORK.md, BAD-686): the audit list of blocked commands, newest first, kept in
// `fork-command-guard-audit.json` in the data folder (mode 0600). An unreadable file starts empty.
// Commands may hold secrets typed into a command line: they are cut to 400 characters and the
// file is private to the user. Keep electron out of this file.
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  COMMAND_GUARD_SURFACES,
  isCommandGuardRule,
  type CommandGuardAuditEntry
} from '../../../shared/fork/command-guards'

export const COMMAND_GUARD_AUDIT_FILE = 'fork-command-guard-audit.json'
const MAX_COMMAND = 400
const MAX_FIELD = 600

let entries: CommandGuardAuditEntry[] = []
let path: string | null = null
let saving: Promise<void> = Promise.resolve()

function readEntry(value: unknown): CommandGuardAuditEntry | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const raw: Record<string, unknown> = { ...value }
  const { id, at, agent, workspaceId, rule, reason, command, surface } = raw
  const knownSurface = COMMAND_GUARD_SURFACES.find((known) => known === surface)
  return typeof id === 'string' &&
    typeof at === 'number' &&
    typeof agent === 'string' &&
    typeof workspaceId === 'string' &&
    isCommandGuardRule(rule) &&
    typeof reason === 'string' &&
    typeof command === 'string'
    ? {
        id: id.slice(0, MAX_FIELD),
        at,
        agent: agent.slice(0, 60),
        ...(knownSurface ? { surface: knownSurface } : {}),
        workspaceId: workspaceId.slice(0, MAX_FIELD),
        rule,
        reason: reason.slice(0, MAX_FIELD),
        command: command.slice(0, MAX_COMMAND)
      }
    : null
}

/** Loads the saved list once the data folder is known; entries added before then are kept. */
export function openCommandGuardAudit(dataDirectory: string): void {
  const next = join(dataDirectory, COMMAND_GUARD_AUDIT_FILE)
  if (next === path) {
    return
  }
  path = next
  try {
    const saved: unknown = JSON.parse(readFileSync(path, 'utf8'))
    const loaded = (Array.isArray(saved) ? saved : []).flatMap((value) => readEntry(value) ?? [])
    entries = [...entries, ...loaded].sort((a, b) => b.at - a.at)
  } catch {
    // A missing or unreadable file is an empty list.
  }
}

function save(): void {
  if (!path) {
    return
  }
  const target = path
  const text = JSON.stringify(entries)
  saving = saving
    .then(async () => {
      const temp = `${target}.${randomUUID()}.tmp`
      await writeFile(temp, text, { mode: 0o600 })
      await rename(temp, target)
    })
    .catch((error: unknown) => console.warn('[fork-command-guards] could not save', error))
}

export function recordCommandGuardBlock(
  entry: Omit<CommandGuardAuditEntry, 'id'>,
  limit: number
): CommandGuardAuditEntry {
  const added: CommandGuardAuditEntry = {
    ...entry,
    id: randomUUID(),
    command: entry.command.slice(0, MAX_COMMAND),
    reason: entry.reason.slice(0, MAX_FIELD)
  }
  entries = [added, ...entries].slice(0, limit)
  save()
  return added
}

export function listCommandGuardAudit(limit: number): CommandGuardAuditEntry[] {
  return entries.slice(0, limit)
}
