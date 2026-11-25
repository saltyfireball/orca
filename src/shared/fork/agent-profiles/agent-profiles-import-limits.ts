// BAD-817: the fields of an agent definition that limit it. permissionMode maps to the profile's
// mode; every other limit is named as not kept, so the profile needs a confirm before use.
import type { ForkAgentProfilePermissionMode } from './agent-profiles-types'

export type ForkAgentDefinitionLimits = {
  permissionMode?: ForkAgentProfilePermissionMode
  notKept: string[]
}

/** `disallowedTools`, `disallowed_tools` and `disallowed-tools` are one field. */
export function forkAgentDefinitionKey(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '')
}

const CLAUDE_MODES: Record<string, ForkAgentProfilePermissionMode> = {
  default: 'ask',
  ask: 'ask',
  acceptedits: 'accept-edits',
  auto: 'auto',
  bypasspermissions: 'full-access',
  fullaccess: 'full-access'
}

/** Modes narrower than any profile mode: the profile uses ask, the narrowest it has. */
const NARROWER_THAN_ASK: Record<string, string> = {
  plan: 'read-only plan mode',
  dontask: 'denies what is not allowed'
}

const CLAUDE_LIMITS = new Set(['tools', 'disallowedtools', 'mcpservers', 'hooks', 'maxturns'])

const CODEX_LIMITS = new Set([
  'sandboxmode',
  'approvalpolicy',
  'mcpservers',
  'sandboxworkspacewrite',
  'shellenvironmentpolicy',
  'tools',
  'permissions'
])
const CODEX_MODE_FIELDS = new Set(['sandboxmode', 'approvalpolicy'])

function scalarText(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value).trim()
    : undefined
}

/** One not-kept line: a comma string, a list, or a table's keys. */
function described(key: string, value: unknown): string {
  const values = Array.isArray(value)
    ? value.map((entry) => scalarText(entry) ?? JSON.stringify(entry))
    : value && typeof value === 'object'
      ? Object.keys(value)
      : [scalarText(value) ?? '']
  const text = values.filter(Boolean).join(', ')
  return text ? `${key}: ${text}`.slice(0, 300) : `${key} (value not readable)`
}

export function forkClaudeDefinitionLimits(
  fields: Record<string, unknown>
): ForkAgentDefinitionLimits {
  const notKept: string[] = []
  let permissionMode: ForkAgentProfilePermissionMode | undefined
  for (const [key, value] of Object.entries(fields)) {
    const id = forkAgentDefinitionKey(key)
    if (id === 'permissionmode') {
      const mode = forkAgentDefinitionKey(scalarText(value) ?? '')
      const mapped = CLAUDE_MODES[mode]
      if (mapped && (!permissionMode || permissionMode === mapped)) {
        permissionMode = mapped
      } else {
        // Fail closed: a mode Orca cannot read, has no match for, or sees twice gets the narrowest.
        permissionMode = 'ask'
        const why = NARROWER_THAN_ASK[mode] ?? (mapped ? 'set twice' : 'not a mode Orca knows')
        notKept.push(`${described(key, value)} (${why}; the profile uses ask)`)
      }
    } else if (CLAUDE_LIMITS.has(id)) {
      notKept.push(described(key, value))
    }
  }
  return { ...(permissionMode ? { permissionMode } : {}), notKept }
}

/** Every table besides the known limits is named too: an agent file's tables are config overrides. */
export function forkCodexDefinitionLimits(
  fields: Record<string, unknown>
): ForkAgentDefinitionLimits {
  const notKept: string[] = []
  let narrowed = false
  for (const [key, value] of Object.entries(fields)) {
    const id = forkAgentDefinitionKey(key)
    if (CODEX_LIMITS.has(id)) {
      notKept.push(described(key, value))
      narrowed ||= CODEX_MODE_FIELDS.has(id)
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      notKept.push(`[${key}] settings`)
    }
  }
  if (narrowed) {
    notKept.push('the sandbox and approval fields are not mapped; the profile uses ask')
  }
  return { ...(narrowed ? { permissionMode: 'ask' as const } : {}), notKept }
}
