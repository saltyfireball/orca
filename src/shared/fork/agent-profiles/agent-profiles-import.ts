// Reads an agent definition file from .claude/agents, .codex/agents or .agents/agents into a
// profile. Markdown files carry YAML frontmatter (name, description, model, limits) and the prompt
// as the body; Codex files are TOML with `name`, `description`, `model` and `developer_instructions`.
// BAD-817: a file Orca cannot parse whole is refused, so no limit line is skipped unread.
import { parse as parseTomlDocument } from 'smol-toml'
import { parseDocument } from 'yaml'
import {
  forkAgentDefinitionKey,
  forkClaudeDefinitionLimits,
  forkCodexDefinitionLimits,
  type ForkAgentDefinitionLimits
} from './agent-profiles-import-limits'
import { isForkAgentProfileName, type ForkAgentProfile } from './agent-profiles-types'

export type ForkAgentDefinitionDir = '.claude/agents' | '.codex/agents' | '.agents/agents'

export const FORK_AGENT_DEFINITION_DIRS: readonly {
  dir: ForkAgentDefinitionDir
  agent: string
}[] = [
  { dir: '.claude/agents', agent: 'claude' },
  { dir: '.codex/agents', agent: 'codex' },
  { dir: '.agents/agents', agent: 'claude' }
]

type Parsed =
  | { ok: true; fields: Record<string, unknown>; body: string; limits: ForkAgentDefinitionLimits }
  | { ok: false; message: string }

function firstLine(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split('\n')[0].slice(0, 200)
}

function parseMarkdown(source: string): Parsed {
  if (!/^---[ \t]*\r?\n/.test(source)) {
    return { ok: true, fields: {}, body: source, limits: { notKept: [] } }
  }
  const match = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(source)
  if (!match) {
    return { ok: false, message: 'its frontmatter has no closing --- line.' }
  }
  const doc = parseDocument(match[1] ?? '')
  if (doc.errors.length > 0) {
    return {
      ok: false,
      message: `its frontmatter is not valid YAML (${firstLine(doc.errors[0])}).`
    }
  }
  const value: unknown = doc.toJS()
  if (value !== null && (typeof value !== 'object' || Array.isArray(value))) {
    return { ok: false, message: 'its frontmatter is not a list of "key: value" fields.' }
  }
  const fields = (value ?? {}) as Record<string, unknown>
  return { ok: true, fields, body: match[2], limits: forkClaudeDefinitionLimits(fields) }
}

function parseToml(source: string): Parsed {
  let fields: Record<string, unknown>
  try {
    fields = parseTomlDocument(source) as Record<string, unknown>
  } catch (error) {
    return { ok: false, message: `it is not valid TOML (${firstLine(error)}).` }
  }
  const text = (key: string) => (typeof fields[key] === 'string' ? (fields[key] as string) : '')
  return {
    ok: true,
    fields,
    body: text('developer_instructions') || text('instructions'),
    limits: forkCodexDefinitionLimits(fields)
  }
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+|[-._]+$/g, '')
    .slice(0, 64)
}

export type ForkAgentImportResult =
  | { ok: true; profile: ForkAgentProfile }
  | { ok: false; message: string }

/** `file` is the definition's path (its name is the fallback profile name); `agent` is the harness. */
export function importForkAgentDefinition(args: {
  file: string
  source: string
  agent: string
  /** Replaces the name found in the file. */
  name?: string
}): ForkAgentImportResult {
  const isToml = args.file.toLowerCase().endsWith('.toml')
  const parsed = isToml ? parseToml(args.source) : parseMarkdown(args.source)
  if (!parsed.ok) {
    return { ok: false, message: `Not imported: ${parsed.message}` }
  }
  const { fields, body, limits } = parsed
  const get = (name: string): string | undefined => {
    const entry = Object.entries(fields).find(([key]) => forkAgentDefinitionKey(key) === name)
    const value = entry?.[1]
    return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : undefined
  }
  const base = (args.file.split(/[\\/]/).pop() ?? '').replace(/\.[^.]+$/, '')
  const found = get('name')
  const name = args.name ?? slug(found || base)
  if (!isForkAgentProfileName(name)) {
    return {
      ok: false,
      message: `Cannot make a profile name from "${found || base}".`
    }
  }
  const preamble = body.trim()
  const fileModel = get('model')
  const model = fileModel && fileModel !== 'inherit' ? fileModel : undefined
  const description = get('description')
  return {
    ok: true,
    profile: {
      name,
      agent: args.agent,
      ...(model ? { model } : {}),
      ...(limits.permissionMode ? { permissionMode: limits.permissionMode } : {}),
      ...(preamble ? { preamble } : {}),
      ...(description ? { whenToUse: description.slice(0, 1000) } : {}),
      imported: {
        path: args.file,
        ...(limits.notKept.length > 0 ? { notKept: limits.notKept } : {})
      }
    }
  }
}
