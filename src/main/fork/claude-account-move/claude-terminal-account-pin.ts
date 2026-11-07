// SLRM-1503: a Claude terminal pane restarted by a move carries `ORCA_FORK_CLAUDE_ACCOUNT`. Its
// shell function then reads a pointer of its own instead of the global one, so that one pane runs
// the moved account while the other panes keep following the selection.
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  CLAUDE_INJECTED_CONFIG_DIR_ENV,
  CLAUDE_PROFILE_POINTER_ENV
} from '../../../shared/claude-profile-routing'
import {
  FORK_CLAUDE_SYSTEM_DEFAULT,
  FORK_CLAUDE_TERMINAL_ACCOUNT_ENV
} from '../../../shared/fork/claude-account-move'
import { writeFileAtomically } from '../../codex-accounts/fs-utils'
import { getClaudeProfileRouter } from '../../claude-accounts/claude-profile-installed-router'
import type { ClaudeRuntimeAuthPreparation } from '../../claude-accounts/runtime-auth/runtime-auth-types'
import type { ClaudeAccountSelectionTarget } from '../../claude-accounts/runtime-selection'
import { pinnedClaudeRoute, type PinnedClaudeRouter } from './claude-pinned-route'

type Env = Record<string, string>

/** Point `env` at `home` the way the stock router's launch env does; null home is System default. */
function routeEnv(env: Env, pointer: string, home: string | null): void {
  env[CLAUDE_PROFILE_POINTER_ENV] = pointer
  if (home) {
    env.CLAUDE_CONFIG_DIR = home
    env[CLAUDE_INJECTED_CONFIG_DIR_ENV] = home
    return
  }
  // Only Orca's own folder goes; the shell function restores a user's own CLAUDE_CONFIG_DIR.
  if (env.CLAUDE_CONFIG_DIR && env.CLAUDE_CONFIG_DIR === env[CLAUDE_INJECTED_CONFIG_DIR_ENV]) {
    delete env.CLAUDE_CONFIG_DIR
  }
  delete env[CLAUDE_INJECTED_CONFIG_DIR_ENV]
}

/** One pointer file per account, beside the global pointer; an empty file is System default. */
function writePanePointer(router: PinnedClaudeRouter, name: string, home: string | null): string {
  const folder = join(dirname(router.pointerPath), 'fork-pane-pins')
  const file = join(folder, createHash('sha256').update(name).digest('hex').slice(0, 24))
  mkdirSync(folder, { recursive: true, mode: 0o700 })
  writeFileAtomically(file, home ?? '', { mode: 0o600 })
  return file
}

/**
 * Apply a pane's account pin to its spawn env and Claude launch auth. Without the marker, on a WSL
 * pane, or for an account this host no longer has, both come back unchanged (minus the marker).
 */
export function forkPinTerminalClaudeAccount(
  env: Env | undefined,
  target: ClaudeAccountSelectionTarget | undefined,
  auth: ClaudeRuntimeAuthPreparation | null,
  router: PinnedClaudeRouter | undefined = getClaudeProfileRouter()
): { env: Env | undefined; auth: ClaudeRuntimeAuthPreparation | null } {
  const marker = env?.[FORK_CLAUDE_TERMINAL_ACCOUNT_ENV]?.trim()
  if (!env || marker === undefined) {
    return { env, auth }
  }
  const next: Env = { ...env }
  delete next[FORK_CLAUDE_TERMINAL_ACCOUNT_ENV]
  const route =
    router && target?.runtime !== 'wsl' && marker
      ? pinnedClaudeRoute(router, marker === FORK_CLAUDE_SYSTEM_DEFAULT ? null : marker)
      : null
  if (!router || !route) {
    return { env: next, auth }
  }
  const home = route.kind === 'account' ? route.home : null
  let pointer: string
  try {
    pointer = writePanePointer(router, marker, home)
  } catch (error) {
    // The pane then follows the selection, as stock does.
    console.warn('[fork-claude-account-move] Could not write a pane pointer:', error)
    return { env: next, auth }
  }
  routeEnv(next, pointer, home)
  if (!auth) {
    return { env: next, auth }
  }
  const envPatch: Env = { ...auth.envPatch }
  routeEnv(envPatch, pointer, home)
  return {
    env: next,
    auth: {
      ...auth,
      envPatch,
      configDir: home ?? router.systemDefaultHome(),
      provenance: home ? `profile:${marker}` : 'system'
    }
  }
}
