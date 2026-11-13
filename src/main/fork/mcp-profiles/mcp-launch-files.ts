// FORK.md "MCP profiles": the per-launch MCP config file and where Claude keeps its own config.
// The file holds server definitions, env values included, so it lives in a folder only the user
// can read, is written owner-only, and is never logged. Each chat has one file, replaced on
// every start; files from earlier runs are swept at startup and on quit.
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, lstat, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/
/** A running Claude read its file at start; older files only linger after a crash. */
const STALE_MS = 24 * 60 * 60 * 1000

export async function ensurePrivateFolder(folder: string): Promise<void> {
  await mkdir(folder, { recursive: true, mode: 0o700 })
  const info = await lstat(folder)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('The MCP profile folder is not a plain folder.')
  }
  if (process.platform !== 'win32') {
    await chmod(folder, 0o700)
  }
}

/** Writes `{ mcpServers }` for one chat and returns its path. */
export async function writeLaunchMcpConfig(
  folder: string,
  sessionId: string,
  servers: ReadonlyMap<string, Record<string, unknown>>
): Promise<string> {
  if (!SAFE_ID.test(sessionId)) {
    throw new Error('Unexpected chat id for an MCP config file.')
  }
  await ensurePrivateFolder(folder)
  const target = join(folder, `${sessionId}.json`)
  const temp = join(folder, `${sessionId}.${randomBytes(6).toString('hex')}.tmp`)
  const body = JSON.stringify({ mcpServers: Object.fromEntries(servers) }, null, 2)
  // wx: never follow or reuse a file someone else put there.
  await writeFile(temp, body, { mode: 0o600, flag: 'wx' })
  try {
    await rename(temp, target)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
  return target
}

export async function removeLaunchMcpConfig(folder: string, sessionId: string): Promise<void> {
  if (SAFE_ID.test(sessionId)) {
    await rm(join(folder, `${sessionId}.json`), { force: true })
  }
}

/** Removes files older than a day (or every file with `all`). Errors are ignored. */
export async function sweepLaunchMcpConfigs(
  folder: string,
  options: { all?: boolean; now?: number } = {}
): Promise<number> {
  let names: string[]
  try {
    names = await readdir(folder)
  } catch {
    return 0
  }
  const now = options.now ?? Date.now()
  let removed = 0
  for (const name of names) {
    if (!name.endsWith('.json') && !name.endsWith('.tmp')) {
      continue
    }
    const path = join(folder, name)
    try {
      if (!options.all && now - (await stat(path)).mtimeMs < STALE_MS) {
        continue
      }
      await rm(path, { force: true })
      removed += 1
    } catch {
      // Gone already, or not ours to remove.
    }
  }
  return removed
}

export type ClaudeConfigPaths = { globalConfig: string; userSettings: string }

/**
 * Claude reads `$CLAUDE_CONFIG_DIR/.claude.json` when that variable is set (every Orca managed
 * account sets it to the account folder) and `~/.claude.json` otherwise. Its settings live in
 * the config folder either way. `configDir` is the folder the launch runs on; `configDirSet`
 * says the user's own environment names it, even when it is the default `~/.claude`.
 */
export function claudeConfigPaths(input: {
  configDir: string
  configDirSet: boolean
  home?: string
}): ClaudeConfigPaths {
  const home = input.home ?? homedir()
  const folder = resolve(input.configDir)
  const isDefault = folder === resolve(join(home, '.claude'))
  const globalConfig =
    input.configDirSet || !isDefault ? join(folder, '.claude.json') : join(home, '.claude.json')
  return { globalConfig, userSettings: join(folder, 'settings.json') }
}

/** Claude refuses `--strict-mcp-config` while an enterprise MCP policy file exists. */
export function managedMcpPolicyFiles(platform: NodeJS.Platform = process.platform): string[] {
  if (platform === 'darwin') {
    return ['/Library/Application Support/ClaudeCode/managed-mcp.json']
  }
  if (platform === 'win32') {
    return [
      'C:\\Program Files\\ClaudeCode\\managed-mcp.json',
      'C:\\ProgramData\\ClaudeCode\\managed-mcp.json'
    ]
  }
  return ['/etc/claude-code/managed-mcp.json']
}

export function hasManagedMcpPolicy(files: readonly string[] = managedMcpPolicyFiles()): boolean {
  return files.some((file) => existsSync(file))
}
