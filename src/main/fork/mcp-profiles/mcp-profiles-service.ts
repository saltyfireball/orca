// FORK.md "MCP profiles": the app's profile state and the calls the hooks, IPC and RPC make.
// Without install (headless hosts, tests of upstream code) every hook passes through, so chats
// load every server as stock does.
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import {
  FORK_MCP_PROFILE_ALL,
  forkMcpProfileConfigOf,
  forkMcpProfileExists,
  resolveForkMcpProfile,
  type ForkMcpChatInfo,
  type ForkMcpListing,
  type ForkMcpProfileConfig,
  type ForkMcpProfileSettings
} from '../../../shared/fork/mcp-profiles'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { InvalidArgumentError } from '../../runtime/rpc/core'
import { discoverClaudeMcpServers, forkMcpServerViews } from './claude-mcp-discovery'
import { ForkMcpChatStore } from './mcp-chat-state'
import { claudeConfigPaths, sweepLaunchMcpConfigs } from './mcp-launch-files'
import { currentForkMcpLaunchScope, setForkMcpProfileCheck } from './mcp-launch-scope'

type ServiceState = {
  readSettings: () => ForkMcpProfileSettings | undefined
  store: ForkMcpChatStore
  /** Where per-launch config files go. */
  launchFolder: string
}

let state: ServiceState | null = null

export function forkMcpServiceState(): ServiceState | null {
  return state
}

/** Test seam and install: the settings reader and the data folder the fork owns. */
export async function installForkMcpProfiles(input: {
  readSettings: () => ForkMcpProfileSettings | undefined
  dataFolder: string
  chatStateFile?: string | null
}): Promise<void> {
  const store = new ForkMcpChatStore(
    input.chatStateFile === undefined ? join(input.dataFolder, 'chats.json') : input.chatStateFile
  )
  await store.load()
  state = {
    readSettings: input.readSettings,
    store,
    launchFolder: join(input.dataFolder, 'launch')
  }
  setForkMcpProfileCheck((name) => forkMcpProfileExists(forkMcpConfig().profiles, name))
  // Files a crashed run left behind; a running chat's file is replaced on its next start.
  await sweepLaunchMcpConfigs(state.launchFolder)
}

/** On quit: every per-launch file goes, and the chat state is written. */
export async function shutdownForkMcpProfiles(): Promise<void> {
  if (!state) {
    return
  }
  await Promise.all([state.store.flush(), sweepLaunchMcpConfigs(state.launchFolder, { all: true })])
}

export function uninstallForkMcpProfilesForTests(): void {
  state = null
  setForkMcpProfileCheck(null)
}

export function forkMcpConfig(): ForkMcpProfileConfig {
  return forkMcpProfileConfigOf(state?.readSettings() ?? {})
}

/** Chat creation hook: remembers how a new chat was launched and the profile asked for. */
export function noteForkMcpNewChat(sessionId: string, provider: string): void {
  const launch = currentForkMcpLaunchScope()
  if (!state || !launch) {
    return
  }
  state.store.update(sessionId, (current) => ({
    ...current,
    kind: launch.kind,
    provider,
    ...(launch.profile ? { chosen: launch.profile } : {})
  }))
}

/** A linked worktree's main checkout, read from its `.git` file; null for anything else. */
export async function mainCheckoutOf(folder: string): Promise<string | null> {
  try {
    const text = await readFile(join(folder, '.git'), 'utf8')
    const match = /^gitdir:\s*(.+)$/m.exec(text)
    const gitdir = match?.[1]?.trim()
    if (!gitdir || basename(dirname(gitdir)) !== 'worktrees') {
      return null
    }
    return dirname(dirname(dirname(gitdir)))
  } catch {
    return null
  }
}

function recordOf(sessionId: string): { provider: string; launchDirectory?: string } | null {
  try {
    return getStructuredAgentSessionHost()?.deps.store.getRecord(sessionId) ?? null
  } catch {
    return null
  }
}

/** The chat's folders a project entry matches: its own and its worktree's main checkout. */
export async function chatFolders(folder: string | undefined): Promise<string[]> {
  if (!folder) {
    return []
  }
  const main = await mainCheckoutOf(folder)
  return main ? [folder, main] : [folder]
}

export async function forkMcpChat(sessionId: string): Promise<ForkMcpChatInfo | null> {
  if (!state) {
    return null
  }
  const config = forkMcpConfig()
  const saved = state.store.get(sessionId)
  const record = recordOf(sessionId)
  const provider = record?.provider ?? saved?.provider ?? null
  const kind = saved?.kind ?? 'interactive'
  const chosen = saved?.chosen ?? null
  const next = resolveForkMcpProfile(config, {
    chosen,
    kind,
    folders: await chatFolders(record?.launchDirectory)
  })
  const last = saved?.last ?? null
  return {
    sessionId,
    provider,
    kind,
    chosen,
    next,
    last,
    changePending: last !== null && last.profile !== next.profile,
    supported: provider === 'claude'
  }
}

export async function forkMcpSetChat(
  sessionId: string,
  profile: string | null
): Promise<ForkMcpChatInfo | null> {
  if (!state) {
    return null
  }
  if (profile !== null && !forkMcpProfileExists(forkMcpConfig().profiles, profile)) {
    throw new InvalidArgumentError(`Unknown MCP profile "${profile}".`)
  }
  state.store.update(sessionId, (current) => {
    const { chosen: _chosen, ...rest } = current
    return profile === null ? rest : { ...rest, chosen: profile }
  })
  return forkMcpChat(sessionId)
}

/** The servers Claude would load for a folder (user servers only without one), plus profiles. */
export async function forkMcpList(folder?: string): Promise<ForkMcpListing> {
  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim()
  const paths = claudeConfigPaths({
    configDir: configDir || join(homedir(), '.claude'),
    configDirSet: !!configDir
  })
  const discovery = await discoverClaudeMcpServers({
    folder: folder ?? null,
    ...paths
  })
  const config = forkMcpConfig()
  return {
    folder: folder ?? null,
    agent: 'claude',
    servers: forkMcpServerViews(discovery),
    notes: [
      ...discovery.notes,
      "Listed for Claude on its default account; a chat on another Claude account also loads that account's user servers.",
      'Not listed: plugin and claude.ai connector servers, which Claude adds on its own (a profile other than "all" leaves them out), and Codex or other agents\' servers.'
    ],
    profiles: config.profiles,
    defaults: config.defaults,
    projects: config.projects
  }
}

export function forkMcpIsAll(profile: string): boolean {
  return profile === FORK_MCP_PROFILE_ALL
}
