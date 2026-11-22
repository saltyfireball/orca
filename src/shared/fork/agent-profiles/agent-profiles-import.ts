// Reads an agent definition file from .claude/agents, .codex/agents or .agents/agents into a
// profile. Markdown files carry frontmatter (name, description, model) and the prompt as the body;
// Codex files are TOML with `name`, `description`, `model` and `developer_instructions`.
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

type Parsed = { fields: Record<string, string>; body: string }

function unquote(value: string): string {
  const trimmed = value.trim()
  const quote = trimmed[0]
  if ((quote === '"' || quote === "'") && trimmed.endsWith(quote) && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"')
  }
  return trimmed
}

function parseMarkdown(source: string): Parsed {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(source)
  if (!match) {
    return { fields: {}, body: source }
  }
  const fields: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (pair) {
      fields[pair[1].toLowerCase()] = unquote(pair[2])
    }
  }
  return { fields, body: match[2] }
}

function parseToml(source: string): Parsed {
  const fields: Record<string, string> = {}
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const pair = /^([A-Za-z_][\w-]*)\s*=\s*(.*)$/.exec(lines[i])
    if (!pair) {
      continue
    }
    const key = pair[1].toLowerCase()
    const value = pair[2]
    const triple = /^("""|''')([\s\S]*)$/.exec(value)
    if (triple) {
      const parts: string[] = []
      let rest = triple[2]
      while (!rest.includes(triple[1]) && i + 1 < lines.length) {
        parts.push(rest)
        i += 1
        rest = lines[i]
      }
      parts.push(rest.split(triple[1])[0])
      fields[key] = parts.join('\n').replace(/^\n/, '').trim()
    } else {
      fields[key] = unquote(value.replace(/\s+#.*$/, ''))
    }
  }
  return {
    fields,
    body: fields.developer_instructions ?? fields.instructions ?? ''
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
  const { fields, body } = isToml ? parseToml(args.source) : parseMarkdown(args.source)
  const base = (args.file.split(/[\\/]/).pop() ?? '').replace(/\.[^.]+$/, '')
  const name = args.name ?? slug(fields.name ?? base)
  if (!isForkAgentProfileName(name)) {
    return {
      ok: false,
      message: `Cannot make a profile name from "${fields.name ?? base}".`
    }
  }
  const preamble = body.trim()
  const model = fields.model && fields.model !== 'inherit' ? fields.model : undefined
  return {
    ok: true,
    profile: {
      name,
      agent: args.agent,
      ...(model ? { model } : {}),
      ...(preamble ? { preamble } : {}),
      ...(fields.description ? { whenToUse: fields.description.slice(0, 1000) } : {}),
      imported: { path: args.file }
    }
  }
}
