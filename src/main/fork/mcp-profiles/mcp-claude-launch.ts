// FORK.md "MCP profiles": the one hook in Claude's native chat launch. It picks the chat's
// profile and, for anything but "all", returns the arguments that make Claude load only the
// profile's servers: `--strict-mcp-config` plus `--mcp-config <file>` with the kept servers'
// own definitions. Nothing here ever fails a launch; a profile that cannot apply runs the chat
// with every server and says why on the chat.
import {
  FORK_MCP_PROFILE_ALL,
  FORK_MCP_PROFILE_NONE,
  forkMcpProfilesInUse,
  resolveForkMcpProfile,
  selectForkMcpServers,
  type ForkMcpLastLaunch
} from '../../../shared/fork/mcp-profiles'
import { discoverClaudeMcpServers, loadableClaudeMcpServers } from './claude-mcp-discovery'
import {
  claudeConfigPaths,
  hasManagedMcpPolicy,
  managedMcpPolicyFiles,
  writeLaunchMcpConfig
} from './mcp-launch-files'
import { chatFolders, forkMcpConfig, forkMcpServiceState } from './mcp-profiles-service'

export type ForkMcpClaudeLaunch = {
  sessionId: string
  cwd: string
  /** The Claude config folder this launch runs on (the account's home). */
  configDir: string
  env: Readonly<Record<string, string | undefined>>
  /** The chat runs inside WSL, whose config Claude reads from the Linux side. */
  wsl: boolean
  /** The user's own Claude launch arguments, already parsed. */
  userArgs: Readonly<Record<string, string | null>>
  /** Test seam for the enterprise policy check. */
  policyFiles?: readonly string[]
  now?: () => number
}

type ExtraArgs = Record<string, string | null>

const STRICT = 'strict-mcp-config'
const CONFIG = 'mcp-config'

function skipReason(input: ForkMcpClaudeLaunch): string | null {
  if (input.wsl) {
    return 'MCP profiles do not cover chats that run inside WSL yet.'
  }
  if (Object.hasOwn(input.userArgs, CONFIG) || Object.hasOwn(input.userArgs, STRICT)) {
    return 'The Claude launch arguments in Settings already set an MCP config.'
  }
  if (hasManagedMcpPolicy(input.policyFiles ?? managedMcpPolicyFiles())) {
    return 'An enterprise MCP policy is installed; Claude refuses a narrowed MCP config with one.'
  }
  return null
}

/** The hook's call: a chat record and what the launch resolved. */
export function forkMcpClaudeExtraArgs(
  record: { sessionId: string; location: { wslDistro?: string | null } },
  cwd: string,
  configDir: string,
  env: Readonly<Record<string, string | undefined>>,
  userArgs: Readonly<Record<string, string | null>>
): Promise<ExtraArgs> {
  const wsl = !!record.location.wslDistro
  return forkMcpClaudeLaunchArgs({
    sessionId: record.sessionId,
    cwd,
    configDir,
    env,
    wsl,
    userArgs
  })
}

/** Extra Claude arguments for this launch; empty when the chat runs with every server. */
export async function forkMcpClaudeLaunchArgs(input: ForkMcpClaudeLaunch): Promise<ExtraArgs> {
  const state = forkMcpServiceState()
  if (!state) {
    return {}
  }
  const config = forkMcpConfig()
  const saved = state.store.get(input.sessionId)
  if (!forkMcpProfilesInUse(config) && !saved?.chosen) {
    return {}
  }
  const now = input.now ?? Date.now
  const choice = resolveForkMcpProfile(config, {
    chosen: saved?.chosen ?? null,
    kind: saved?.kind ?? 'interactive',
    folders: await chatFolders(input.cwd)
  })
  const record = (last: Omit<ForkMcpLastLaunch, 'at' | 'profile'>): void =>
    state.store.update(input.sessionId, (current) => ({
      ...current,
      provider: 'claude',
      last: { at: now(), profile: choice.profile, ...last }
    }))
  if (choice.profile === FORK_MCP_PROFILE_ALL) {
    record({ applied: false, servers: [] })
    return {}
  }
  const skipped = skipReason(input)
  if (skipped) {
    record({ applied: false, skipped, servers: [] })
    return {}
  }
  if (choice.profile === FORK_MCP_PROFILE_NONE) {
    record({ applied: true, servers: [] })
    return { [STRICT]: null }
  }
  try {
    const paths = claudeConfigPaths({
      configDir: input.configDir,
      configDirSet: !!input.env.CLAUDE_CONFIG_DIR?.trim()
    })
    const loadable = loadableClaudeMcpServers(
      await discoverClaudeMcpServers({ folder: input.cwd, ...paths })
    )
    const kept = selectForkMcpServers(config, choice.profile, [...loadable.keys()])
    const servers = new Map(kept.map((name) => [name, loadable.get(name)!] as const))
    const file = await writeLaunchMcpConfig(state.launchFolder, input.sessionId, servers)
    record({ applied: true, servers: kept })
    return { [STRICT]: null, [CONFIG]: file }
  } catch (error) {
    // The message only: server definitions never reach a log.
    console.warn('[fork-mcp-profiles] could not build the MCP config', (error as Error).message)
    record({
      applied: false,
      skipped: 'The MCP config for this chat could not be written.',
      servers: []
    })
    return {}
  }
}
