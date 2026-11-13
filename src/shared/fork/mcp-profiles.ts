// FORK.md "MCP profiles": choose which tool (MCP) servers a chat loads. A profile is a named
// allow or deny list of server names; "all" is stock behavior and "none" loads no server.
// Shared by main, preload, the renderer and the CLI. Everything unset resolves to "all".
import { z } from 'zod'

export const FORK_MCP_PROFILE_ALL = 'all'
export const FORK_MCP_PROFILE_NONE = 'none'
export const FORK_MCP_BUILT_IN_PROFILES = [FORK_MCP_PROFILE_ALL, FORK_MCP_PROFILE_NONE] as const

/** How a chat was started: by the user, as an orchestration worker, or by an automation. */
export const FORK_MCP_LAUNCH_KINDS = ['interactive', 'worker', 'background'] as const
export type ForkMcpLaunchKind = (typeof FORK_MCP_LAUNCH_KINDS)[number]

export type ForkMcpProfile = {
  /** The name the CLI flag, settings and chat header use. */
  name: string
  /** allow: only the listed servers load. deny: every server but the listed ones loads. */
  mode: 'allow' | 'deny'
  servers: string[]
}

export type ForkMcpProjectProfile = {
  /** A project folder: a chat whose folder (or whose worktree's main checkout) is in it. */
  path: string
  profile: string
}

export type ForkMcpProfileSettings = {
  /** Fork MCP profiles: the user's named profiles; "all" and "none" are built in. */
  forkMcpProfiles?: ForkMcpProfile[]
  /** Fork MCP profiles: profile for chats the user starts; unset is "all". */
  forkMcpDefaultInteractive?: string
  /** Fork MCP profiles: profile for orchestration workers; unset is "all". */
  forkMcpDefaultWorker?: string
  /** Fork MCP profiles: profile for automation runs; unset is "all". */
  forkMcpDefaultBackground?: string
  /** Fork MCP profiles: per-project profiles, which take precedence over the launch kind's. */
  forkMcpProjectProfiles?: ForkMcpProjectProfile[]
}

const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
export const FORK_MCP_MAX_PROFILES = 64
export const FORK_MCP_MAX_SERVERS_PER_PROFILE = 256

export function isForkMcpProfileName(value: string): boolean {
  return PROFILE_NAME.test(value)
}

export function isForkMcpBuiltInProfile(name: string): boolean {
  return name === FORK_MCP_PROFILE_ALL || name === FORK_MCP_PROFILE_NONE
}

export type ForkMcpProfileConfig = {
  profiles: ForkMcpProfile[]
  defaults: Record<ForkMcpLaunchKind, string>
  projects: ForkMcpProjectProfile[]
}

function cleanProfiles(raw: unknown): ForkMcpProfile[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const seen = new Set<string>()
  const profiles: ForkMcpProfile[] = []
  for (const entry of raw.slice(0, FORK_MCP_MAX_PROFILES)) {
    if (!entry || typeof entry !== 'object') {
      continue
    }
    const { name, mode, servers } = entry as Partial<ForkMcpProfile>
    if (typeof name !== 'string' || !isForkMcpProfileName(name) || isForkMcpBuiltInProfile(name)) {
      continue
    }
    if (seen.has(name)) {
      continue
    }
    seen.add(name)
    const list = Array.isArray(servers)
      ? Array.from(
          new Set(servers.filter((s): s is string => typeof s === 'string' && s.trim() !== ''))
        )
          .map((s) => s.trim())
          .slice(0, FORK_MCP_MAX_SERVERS_PER_PROFILE)
      : []
    profiles.push({
      name,
      mode: mode === 'deny' ? 'deny' : 'allow',
      servers: list
    })
  }
  return profiles
}

/** The settings as main reads them; anything unset or broken takes "all". */
export function forkMcpProfileConfigOf(settings: ForkMcpProfileSettings): ForkMcpProfileConfig {
  const profiles = cleanProfiles(settings.forkMcpProfiles)
  const known = (name: unknown): string =>
    typeof name === 'string' && forkMcpProfileExists(profiles, name) ? name : FORK_MCP_PROFILE_ALL
  const projects = Array.isArray(settings.forkMcpProjectProfiles)
    ? settings.forkMcpProjectProfiles.filter(
        (entry): entry is ForkMcpProjectProfile =>
          !!entry &&
          typeof entry.path === 'string' &&
          entry.path.trim() !== '' &&
          typeof entry.profile === 'string'
      )
    : []
  return {
    profiles,
    defaults: {
      interactive: known(settings.forkMcpDefaultInteractive),
      worker: known(settings.forkMcpDefaultWorker),
      background: known(settings.forkMcpDefaultBackground)
    },
    projects: projects.map((entry) => ({
      path: entry.path.trim(),
      profile: known(entry.profile)
    }))
  }
}

export function forkMcpProfileExists(profiles: readonly ForkMcpProfile[], name: string): boolean {
  return isForkMcpBuiltInProfile(name) || profiles.some((profile) => profile.name === name)
}

/** True when any setting would change what a chat loads; otherwise launches are untouched. */
export function forkMcpProfilesInUse(config: ForkMcpProfileConfig): boolean {
  return (
    config.profiles.length > 0 ||
    Object.values(config.defaults).some((name) => name !== FORK_MCP_PROFILE_ALL) ||
    config.projects.some((entry) => entry.profile !== FORK_MCP_PROFILE_ALL)
  )
}

export type ForkMcpProfileSource = 'chat' | 'project' | 'kind'

export type ForkMcpProfileChoice = {
  profile: string
  source: ForkMcpProfileSource
}

function normalizeFolder(path: string): string {
  const slashed = path.replace(/\\/g, '/')
  return slashed.length > 1 ? slashed.replace(/\/+$/, '') : slashed
}

function isInside(folder: string, candidate: string): boolean {
  const root = normalizeFolder(folder)
  const child = normalizeFolder(candidate)
  return child === root || child.startsWith(root === '/' ? '/' : `${root}/`)
}

/**
 * The profile a launch uses: the chat's own choice, else the closest project entry that holds
 * one of the chat's folders, else the default for its launch kind. A chosen profile that was
 * deleted since falls through to the defaults.
 */
export function resolveForkMcpProfile(
  config: ForkMcpProfileConfig,
  input: {
    chosen?: string | null
    kind: ForkMcpLaunchKind
    folders: readonly string[]
  }
): ForkMcpProfileChoice {
  if (input.chosen && forkMcpProfileExists(config.profiles, input.chosen)) {
    return { profile: input.chosen, source: 'chat' }
  }
  let best: ForkMcpProjectProfile | null = null
  for (const entry of config.projects) {
    if (!input.folders.some((folder) => isInside(entry.path, folder))) {
      continue
    }
    if (!best || normalizeFolder(entry.path).length > normalizeFolder(best.path).length) {
      best = entry
    }
  }
  if (best) {
    return { profile: best.profile, source: 'project' }
  }
  return { profile: config.defaults[input.kind], source: 'kind' }
}

/** The servers a profile keeps out of the ones that would load; "all" keeps every one. */
export function selectForkMcpServers(
  config: ForkMcpProfileConfig,
  profileName: string,
  loadable: readonly string[]
): string[] {
  if (profileName === FORK_MCP_PROFILE_ALL) {
    return [...loadable]
  }
  const profile = config.profiles.find((entry) => entry.name === profileName)
  if (profileName === FORK_MCP_PROFILE_NONE || !profile) {
    return []
  }
  const listed = new Set(profile.servers)
  return loadable.filter((name) =>
    profile.mode === 'allow' ? listed.has(name) : !listed.has(name)
  )
}

// ---- discovery, chat state and the wire shapes -------------------------------------------

export type ForkMcpServerScope = 'user' | 'project' | 'local'

/** enabled: would load. unapproved: a project server the user never approved. disabled: turned
 *  off in Claude. shadowed: a server of the same name in a closer scope wins. */
export type ForkMcpServerStatus = 'enabled' | 'unapproved' | 'disabled' | 'shadowed'

/** A discovered server as shown; never carries env values, headers or arguments. */
export type ForkMcpServerView = {
  name: string
  scope: ForkMcpServerScope
  status: ForkMcpServerStatus
  transport: 'stdio' | 'http' | 'sse' | 'unknown'
  /** The config file it came from. */
  source: string
  /** The program a stdio server runs (no arguments). */
  command?: string
}

export type ForkMcpLastLaunch = {
  at: number
  profile: string
  /** False when the launch ran with every server (profile "all", or applying was not possible). */
  applied: boolean
  /** Why a non-"all" profile was not applied. */
  skipped?: string
  /** The servers the launch was given, when applied. */
  servers: string[]
}

export type ForkMcpChatInfo = {
  sessionId: string
  provider: string | null
  kind: ForkMcpLaunchKind
  /** The profile chosen for this chat, if any (else the defaults decide). */
  chosen: string | null
  /** What the next start uses. */
  next: ForkMcpProfileChoice
  last: ForkMcpLastLaunch | null
  /** The next start runs with a different profile than the running one. */
  changePending: boolean
  /** Profiles apply to Claude chats only. */
  supported: boolean
}

export type ForkMcpListing = {
  folder: string | null
  agent: 'claude'
  servers: ForkMcpServerView[]
  notes: string[]
  profiles: ForkMcpProfile[]
  defaults: Record<ForkMcpLaunchKind, string>
  projects: ForkMcpProjectProfile[]
}

export const ForkMcpListParams = z.object({
  /** A folder to discover project and local servers for; user servers only when absent. */
  folder: z.string().min(1).max(4096).optional()
})

export const ForkMcpChatParams = z.object({
  sessionId: z.string().min(1).max(512)
})

export const ForkMcpChatSetParams = z.object({
  sessionId: z.string().min(1).max(512),
  /** A profile name, or null to go back to the defaults. */
  profile: z.string().min(1).max(64).nullable()
})

/** The param the CLI adds to agent.launch, worktree.create and orchestration.workerStart. */
export const FORK_MCP_PROFILE_PARAM = 'forkMcpProfile'

export const FORK_MCP_CHANNELS = {
  list: 'fork:mcpProfiles:list',
  chat: 'fork:mcpProfiles:chat',
  setChat: 'fork:mcpProfiles:setChat'
} as const

export type ForkMcpProfilesApi = {
  list: (folder?: string) => Promise<ForkMcpListing>
  chat: (sessionId: string) => Promise<ForkMcpChatInfo | null>
  setChat: (sessionId: string, profile: string | null) => Promise<ForkMcpChatInfo | null>
}
