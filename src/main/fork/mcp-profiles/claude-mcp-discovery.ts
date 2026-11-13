// FORK.md "MCP profiles": the MCP servers Claude Code would load for a folder, read the way
// Claude reads them. Read-only: nothing here writes to the user's agent config.
//
// - user scope: `mcpServers` in Claude's global config (`~/.claude.json`, or
//   `$CLAUDE_CONFIG_DIR/.claude.json` for an account with its own folder).
// - local scope: `projects[<folder>].mcpServers` in that same file.
// - project scope: `.mcp.json` in the folder and its parents (the closest wins). Claude loads one
//   only once approved: `enableAllProjectMcpServers` or `enabledMcpjsonServers` in a settings
//   file, and not in `disabledMcpjsonServers`.
// - `projects[<folder>].disabledMcpServers` turns a server off in any scope.
// Precedence on a shared name is local, then project, then user.
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  ForkMcpServerScope,
  ForkMcpServerStatus,
  ForkMcpServerView
} from '../../../shared/fork/mcp-profiles'

/** Claude's global config grows with history; anything past this is not read. */
const MAX_CONFIG_BYTES = 64 * 1024 * 1024
const MAX_PARENT_WALK = 64

export type ClaudeMcpPaths = {
  /** The chat's folder; null lists user servers only. */
  folder: string | null
  /** Claude's global config file. */
  globalConfig: string
  /** Claude's user settings file (`<config dir>/settings.json`). */
  userSettings: string
}

export type DiscoveredClaudeMcpServer = ForkMcpServerView & {
  /** The server's own definition, for the generated config only; never shown or logged. */
  definition: Record<string, unknown>
}

export type ClaudeMcpDiscovery = {
  servers: DiscoveredClaudeMcpServer[]
  notes: string[]
}

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Missing is null; unreadable or not JSON is a note and null. */
async function readJson(path: string, notes: string[]): Promise<JsonObject | null> {
  let text: string
  try {
    const buffer = await readFile(path)
    if (buffer.byteLength > MAX_CONFIG_BYTES) {
      notes.push(`Skipped ${path}: larger than the read limit.`)
      return null
    }
    text = buffer.toString('utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      notes.push(`Could not read ${path}.`)
    }
    return null
  }
  try {
    const parsed: unknown = JSON.parse(text)
    return isObject(parsed) ? parsed : null
  } catch {
    notes.push(`Could not parse ${path} as JSON.`)
    return null
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

function transportOf(definition: JsonObject): ForkMcpServerView['transport'] {
  const type = definition.type
  if (type === 'http' || type === 'sse' || type === 'stdio') {
    return type
  }
  if (typeof definition.command === 'string') {
    return 'stdio'
  }
  return typeof definition.url === 'string' ? 'http' : 'unknown'
}

/** The program name only; arguments can carry tokens. */
function commandOf(definition: JsonObject): string | undefined {
  return typeof definition.command === 'string' ? definition.command.slice(0, 512) : undefined
}

/** Claude keys projects by the folder; Windows folders may be stored with either slash. */
function projectEntry(global: JsonObject | null, folder: string | null): JsonObject | null {
  if (!folder || !global || !isObject(global.projects)) {
    return null
  }
  const projects = global.projects
  for (const key of [folder, folder.replace(/\\/g, '/')]) {
    if (Object.hasOwn(projects, key) && isObject(projects[key])) {
      return projects[key]
    }
  }
  return null
}

function serversOf(value: unknown): [string, JsonObject][] {
  if (!isObject(value)) {
    return []
  }
  return Object.entries(value).filter((entry): entry is [string, JsonObject] => isObject(entry[1]))
}

/** `.mcp.json` files from the folder up, closest first. */
async function projectFiles(
  folder: string,
  notes: string[]
): Promise<{ path: string; json: JsonObject }[]> {
  const found: { path: string; json: JsonObject }[] = []
  let current = folder
  for (let step = 0; step < MAX_PARENT_WALK; step += 1) {
    const path = join(current, '.mcp.json')
    const json = await readJson(path, notes)
    if (json) {
      found.push({ path, json })
    }
    const parent = dirname(current)
    if (parent === current) {
      break
    }
    current = parent
  }
  return found
}

type Approval = { all: boolean; enabled: Set<string>; disabled: Set<string> }

async function projectApproval(
  paths: ClaudeMcpPaths,
  project: JsonObject | null,
  notes: string[]
): Promise<Approval> {
  const files = [
    paths.userSettings,
    ...(paths.folder
      ? [
          join(paths.folder, '.claude', 'settings.json'),
          join(paths.folder, '.claude', 'settings.local.json')
        ]
      : [])
  ]
  const sources = [project, ...(await Promise.all(files.map((file) => readJson(file, notes))))]
  const approval: Approval = {
    all: false,
    enabled: new Set(),
    disabled: new Set()
  }
  for (const source of sources) {
    if (!source) {
      continue
    }
    if (source.enableAllProjectMcpServers === true) {
      approval.all = true
    }
    stringList(source.enabledMcpjsonServers).forEach((name) => approval.enabled.add(name))
    stringList(source.disabledMcpjsonServers).forEach((name) => approval.disabled.add(name))
  }
  return approval
}

function projectStatus(name: string, approval: Approval): ForkMcpServerStatus {
  if (approval.disabled.has(name)) {
    return 'disabled'
  }
  return approval.all || approval.enabled.has(name) ? 'enabled' : 'unapproved'
}

export async function discoverClaudeMcpServers(paths: ClaudeMcpPaths): Promise<ClaudeMcpDiscovery> {
  const notes: string[] = []
  const global = await readJson(paths.globalConfig, notes)
  const project = projectEntry(global, paths.folder)
  const turnedOff = new Set(stringList(project?.disabledMcpServers))
  const approval = await projectApproval(paths, project, notes)
  const servers: DiscoveredClaudeMcpServer[] = []
  const taken = new Set<string>()
  const add = (
    scope: ForkMcpServerScope,
    source: string,
    entries: [string, JsonObject][],
    status: (name: string) => ForkMcpServerStatus
  ): void => {
    for (const [name, definition] of entries) {
      const shadowed = taken.has(name)
      const own = turnedOff.has(name) ? 'disabled' : status(name)
      // A server only claims its name when it would load in its own scope.
      if (!shadowed && own === 'enabled') {
        taken.add(name)
      }
      servers.push({
        name,
        scope,
        status: shadowed ? 'shadowed' : own,
        transport: transportOf(definition),
        source,
        ...(commandOf(definition) ? { command: commandOf(definition) } : {}),
        definition
      })
    }
  }
  add('local', paths.globalConfig, serversOf(project?.mcpServers), () => 'enabled')
  if (paths.folder) {
    for (const file of await projectFiles(paths.folder, notes)) {
      const entries = serversOf(file.json.mcpServers).filter(
        ([name]) => !servers.some((s) => s.scope === 'project' && s.name === name)
      )
      add('project', file.path, entries, (name) => projectStatus(name, approval))
    }
  }
  add('user', paths.globalConfig, serversOf(global?.mcpServers), () => 'enabled')
  return { servers, notes }
}

/** The servers that would load, by name, with their definitions. */
export function loadableClaudeMcpServers(
  discovery: ClaudeMcpDiscovery
): Map<string, Record<string, unknown>> {
  const loadable = new Map<string, Record<string, unknown>>()
  for (const server of discovery.servers) {
    if (server.status === 'enabled' && !loadable.has(server.name)) {
      loadable.set(server.name, server.definition)
    }
  }
  return loadable
}

/** What is safe to show: everything but the definition. */
export function forkMcpServerViews(discovery: ClaudeMcpDiscovery): ForkMcpServerView[] {
  return discovery.servers.map(({ definition: _definition, ...view }) => view)
}
