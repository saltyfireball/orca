// SLRM-1503: the stock launch and launch-home reads ask here first. A pinned chat launches under its
// pin; every other chat falls through to the global selection exactly as stock does.
import { statSync } from 'node:fs'
import type { ClaudeAccountRecipe } from '../../../shared/agent-session/lifecycle/agent-session-acquired-account'
import {
  agentSessionAccountHome,
  type AgentSessionAccountHome
} from '../../../shared/agent-session/lifecycle/agent-session-account-home'
import type { AgentSessionRecord } from '../../../shared/agent-session/lifecycle/agent-session-record'
import {
  CLAUDE_INJECTED_CONFIG_DIR_ENV,
  CLAUDE_PROFILE_POINTER_ENV
} from '../../../shared/claude-profile-routing'
import { getClaudeProfileRouter } from '../../claude-accounts/profiles/routing/claude-profile-installed-router'
import type { ClaudeProfileRouter } from '../../claude-accounts/profiles/routing/claude-profile-router'
import { CLAUDE_STRUCTURED_AGENT } from '../../claude/structured/claude-structured-agent-definition'
import {
  claudeSessionAccountPins,
  type ClaudeSessionAccountPins
} from './claude-session-account-pins'
import { pinnedClaudeRoute, type PinnedClaudeRouter } from './claude-pinned-route'

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Stock's System default home (resolveStructuredClaudeAccountHomePath), minus Orca's own folder. */
function systemHome(router: PinnedClaudeRouter, env: Record<string, string | undefined>): string {
  const own = env.CLAUDE_CONFIG_DIR?.trim()
  const injected = own && own === env[CLAUDE_INJECTED_CONFIG_DIR_ENV]?.trim()
  return (!injected && own) || router.systemDefaultHome()
}

/**
 * The launch account of a pinned chat, with `env` set to run it; null for an unpinned chat. The
 * env shape matches the stock router's own launch env, so the chat-survive launch hash of a moved
 * chat differs from the one it ran with before and its old provider is never adopted back.
 */
export async function forkPinnedClaudeLaunchAccount(
  router: PinnedClaudeRouter,
  env: Record<string, string>,
  sessionId: string,
  pins: Pick<ClaudeSessionAccountPins, 'get'> = claudeSessionAccountPins()
): Promise<ClaudeAccountRecipe | null> {
  const pin = pins.get(sessionId)
  const route = pin === undefined ? null : pinnedClaudeRoute(router, pin)
  if (!route) {
    return null
  }
  env[CLAUDE_PROFILE_POINTER_ENV] = router.pointerPath
  if (route.kind === 'system') {
    const home = systemHome(router, env)
    // Only Orca's own injected folder goes; a CLAUDE_CONFIG_DIR the user set stays, as stock keeps it.
    if (env.CLAUDE_CONFIG_DIR && env.CLAUDE_CONFIG_DIR === env[CLAUDE_INJECTED_CONFIG_DIR_ENV]) {
      delete env.CLAUDE_CONFIG_DIR
    }
    delete env[CLAUDE_INJECTED_CONFIG_DIR_ENV]
    return { route: 'system', home, configDir: env.CLAUDE_CONFIG_DIR ?? null }
  }
  if (!isDirectory(route.home)) {
    await router.prepareAccount?.(route.accountId)
  }
  env.CLAUDE_CONFIG_DIR = route.home
  env[CLAUDE_INJECTED_CONFIG_DIR_ENV] = route.home
  return { route: 'managed', accountId: route.accountId, home: route.home }
}

/** The stock hook's entry: no router means no accounts, so nothing can be pinned. */
export async function forkPinnedClaudeLaunch(
  router: ClaudeProfileRouter | undefined,
  env: Record<string, string>,
  sessionId: string | undefined
): Promise<ClaudeAccountRecipe | null> {
  return router && sessionId ? forkPinnedClaudeLaunchAccount(router, env, sessionId) : null
}

/** The home a start of this pinned chat would use, read without side effects; null when unpinned. */
export function forkPinnedClaudeAccountHome(
  record: Pick<AgentSessionRecord, 'sessionId' | 'provider' | 'location'>,
  launchEnv: Record<string, string | undefined>,
  router: PinnedClaudeRouter | undefined = getClaudeProfileRouter(),
  pins: Pick<ClaudeSessionAccountPins, 'get'> = claudeSessionAccountPins()
): AgentSessionAccountHome | null {
  // WSL chats route through the distro's own selection; pins are host-only (see FORK.md).
  if (!router || record.provider !== 'claude' || record.location.wslDistro) {
    return null
  }
  const pin = pins.get(record.sessionId)
  const route = pin === undefined ? null : pinnedClaudeRoute(router, pin)
  if (!route) {
    return null
  }
  return agentSessionAccountHome(
    CLAUDE_STRUCTURED_AGENT,
    route.kind === 'system' ? systemHome(router, launchEnv) : route.home
  )
}
