import type { ClaudeAccountRecipe } from '../../shared/agent-session/lifecycle/agent-session-acquired-account'
import type { ClaudeProfileRouter } from '../claude-accounts/profiles/routing/claude-profile-router'
import { applyClaudeEnvPatch } from '../claude-accounts/runtime-auth/environment'
import { resolveStructuredClaudeAccountHomePath } from '../runtime/agent-session/environment/structured-agent-account-home'
import { forkPinnedClaudeLaunch } from '../fork/claude-account-move/claude-pinned-launch'

/** The account a launch runs under is the current selection; the receipt records what it used. */
export async function prepareClaudeLaunchAccount(
  router: ClaudeProfileRouter | undefined,
  env: Record<string, string>,
  recordHome: string,
  sessionId?: string
): Promise<ClaudeAccountRecipe> {
  if (!router) {
    return { route: 'system', home: recordHome, configDir: env.CLAUDE_CONFIG_DIR ?? null }
  }
  // SLRM-1503: a chat moved to another account launches under its pin (FORK.md).
  const pinned = await forkPinnedClaudeLaunch(router, env, sessionId)
  if (pinned) {
    return pinned
  }
  const preparation = await router.prepareLaunch()
  const home =
    preparation.provenance === 'system'
      ? await resolveStructuredClaudeAccountHomePath({
          launchEnv: env,
          wslDistro: null,
          getClaudeConfigDirectory: () => router.systemDefaultHome()
        })
      : preparation.configDir
  applyClaudeEnvPatch(env, preparation.envPatch)
  return preparation.provenance.startsWith('profile:')
    ? { route: 'managed', accountId: preparation.provenance.slice('profile:'.length), home }
    : { route: 'system', home, configDir: env.CLAUDE_CONFIG_DIR ?? null }
}
