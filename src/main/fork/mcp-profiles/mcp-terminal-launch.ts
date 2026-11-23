// FORK.md "MCP profiles" (BAD-741): the one hook in the terminal agent plan. A Claude terminal
// started with an MCP profile (`--mcp-profile`, a profile's, or a retry's stored one) gets
// `--strict-mcp-config` and `--mcp-config <file>` after its own arguments, the file holding only
// the kept servers' definitions (0600, never in argv). Where that cannot work it refuses, naming
// why. Without a profile the launch is untouched, byte for byte.
import type { TuiAgent } from '../../../shared/agent-launch/catalog/tui-agent'
import {
  agentLaunchPermissionSettings,
  resolveTuiAgentLaunchRawArgs
} from '../../../shared/agent-launch/choices/tui-agent-launch-defaults'
import { readLaunchPermissionChoice } from '../../../shared/agent-launch/permissions/tui-agent-permission-choice'
import {
  quoteStartupArg,
  type AgentStartupShell
} from '../../../shared/agent-launch/startup/tui-agent-startup-shell'
import { FORK_MCP_PROFILE_ALL } from '../../../shared/fork/mcp-profiles'
import {
  FORK_CLAUDE_SYSTEM_DEFAULT,
  FORK_CLAUDE_TERMINAL_ACCOUNT_ENV
} from '../../../shared/fork/claude-account-move'
import { resolveTerminalStartupCwd } from '../../../shared/shell/launch/terminal-startup-cwd'
import { getClaudeProfileRouter } from '../../claude-accounts/profiles/routing/claude-profile-installed-router'
import { InvalidArgumentError } from '../../runtime/rpc/core'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { forkMcpClaudeTerminalArgs } from './mcp-claude-launch'
import { currentForkMcpLaunchScope } from './mcp-launch-scope'

type Launch = {
  agentArgs?: string | null
  cwd?: string
  accountEnv?: Record<string, string>
}

type Where = {
  workspace: { path: string; connectionId?: string | null }
  wslDistro: string | null | undefined
  shell: AgentStartupShell
  settings: Parameters<typeof agentLaunchPermissionSettings>[1]
  sessionOptions: Readonly<Record<string, unknown>> | undefined
}

/** The Claude config folder this terminal runs on: its pinned account's, else the default. */
function claudeHome(launch: Launch): { configDir: string; configDirSet: boolean } {
  const router = getClaudeProfileRouter()
  const pin = launch.accountEnv?.[FORK_CLAUDE_TERMINAL_ACCOUNT_ENV]
  if (
    router &&
    pin &&
    pin !== FORK_CLAUDE_SYSTEM_DEFAULT &&
    router.savedAccount(pin) &&
    !router.coveredBySystemDefault(pin)
  ) {
    return { configDir: router.accountHome(pin), configDirSet: true }
  }
  const own = process.env.CLAUDE_CONFIG_DIR?.trim()
  return own
    ? { configDir: own, configDirSet: true }
    : { configDir: router?.systemDefaultHome() ?? join(homedir(), '.claude'), configDirSet: false }
}

export async function forkMcpTerminalLaunch<O extends Launch>(
  opts: O,
  agent: TuiAgent,
  where: Where
): Promise<O> {
  const profile = currentForkMcpLaunchScope()?.profile
  if (!profile || profile === FORK_MCP_PROFILE_ALL || agent !== 'claude') {
    return opts
  }
  const refuse = (why: string): never => {
    throw new InvalidArgumentError(
      `MCP profile "${profile}" cannot be applied to this Claude terminal: ${why}. Start it as a chat, or without the MCP profile. Nothing was launched.`
    )
  }
  if (where.workspace.connectionId) {
    refuse("it runs on a remote host, which this computer's MCP config does not reach")
  }
  if (where.wslDistro) {
    refuse('it runs inside WSL')
  }
  const raw =
    opts.agentArgs !== undefined
      ? (opts.agentArgs ?? '')
      : resolveTuiAgentLaunchRawArgs(
          agent,
          agentLaunchPermissionSettings(agent, where.settings, where.sessionOptions),
          readLaunchPermissionChoice(where.sessionOptions) ? 'own' : undefined,
          where.shell
        )
  const narrowed = await forkMcpClaudeTerminalArgs({
    profile,
    cwd: resolveTerminalStartupCwd(where.workspace.path, opts.cwd) ?? where.workspace.path,
    ...claudeHome(opts),
    launchArgs: raw
  })
  if ('refused' in narrowed) {
    return refuse(narrowed.refused)
  }
  const extra = narrowed.args.map((arg) => quoteStartupArg(arg, where.shell)).join(' ')
  return { ...opts, agentArgs: raw.trim() ? `${raw} ${extra}` : extra }
}
