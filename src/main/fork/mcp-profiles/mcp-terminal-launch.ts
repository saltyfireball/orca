// FORK.md "MCP profiles" (BAD-741): the one hook in the terminal agent plan. A Claude terminal
// started with an MCP profile (`--mcp-profile`, a profile's, or a retry's stored one) gets
// `--strict-mcp-config` and `--mcp-config=<file>` after its own arguments, the file holding only
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
  resolveStartupShell,
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
import type { Repo } from '../../../shared/repository/repo-types'
import { getRepoSshConnectionId } from '../../../shared/execution-host/execution-host'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { forkMcpClaudeTerminalArgs } from './mcp-claude-launch'
import { currentForkMcpLaunchScope } from './mcp-launch-scope'
import { currentForkAgentProfileLaunch } from '../agent-profiles/agent-profile-launch-scope'
import { forkAgentProfileTerminalLaunch } from '../agent-profiles/agent-profile-launch-apply'
import type { AgentLaunchPreferences } from '../../../shared/agent-session/lifecycle/operations/agent-session-host-authority'

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

type WorktreeStartup<S> = {
  repo: Pick<Repo, 'path' | 'connectionId' | 'executionHostId'>
  settings: Where['settings']
  agentArgs?: string | null
  sessionOptions?: Readonly<Record<string, unknown>>
  launchPreferences?: AgentLaunchPreferences
  toSessionOptions: (preferences?: AgentLaunchPreferences) => S | undefined
}

/**
 * BAD-800: the hook in a new workspace's startup agent, which builds its own command instead of
 * the terminal plan. Returns the arguments and session options the stock builder takes, with a
 * `--profile`'s capped mode applied and a Claude terminal's MCP profile narrowed, as a terminal's,
 * and (BAD-815) the env that pins the profile's Claude account to that terminal, as a terminal's.
 */
export async function forkWorktreeStartupProfileInputs<S>(
  environment: WorktreeStartup<S>,
  agent: TuiAgent,
  host: {
    platform: NodeJS.Platform
    shell?: AgentStartupShell
    launchRuntime: { pty: { terminalWindowsWslDistro?: string | null } } | Error
  }
): Promise<{
  inputs: { agentArgs?: string | null; sessionOptions: S | undefined }
  env?: Record<string, string>
}> {
  const stockOptions =
    environment.sessionOptions ?? environment.toSessionOptions(environment.launchPreferences)
  const startup: Launch & { startupAgent: TuiAgent; launchPreferences?: AgentLaunchPreferences } = {
    startupAgent: agent,
    ...(environment.launchPreferences ? { launchPreferences: environment.launchPreferences } : {})
  }
  const applied = forkAgentProfileTerminalLaunch(
    startup,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: session options are a string-keyed record; the hook only adds the permission entry.
    stockOptions as Readonly<Record<string, unknown>> | undefined
  )
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the same record with at most the permission entry added.
  const sessionOptions = (applied.sessionOptions ??
    environment.toSessionOptions(applied.opts.launchPreferences)) as S | undefined
  const stock = environment.agentArgs !== undefined ? { agentArgs: environment.agentArgs } : {}
  const connectionId = getRepoSshConnectionId(environment.repo)
  const wslDistro =
    host.launchRuntime instanceof Error ? null : host.launchRuntime.pty.terminalWindowsWslDistro
  const accountEnv = applied.opts.accountEnv
  if (accountEnv) {
    assertStartupAccountApplies(connectionId, wslDistro)
  }
  const withAccount = accountEnv ? { env: accountEnv } : {}
  const profile = currentForkMcpLaunchScope()?.profile
  if (!profile || profile === FORK_MCP_PROFILE_ALL || agent !== 'claude') {
    return { inputs: { ...stock, sessionOptions }, ...withAccount }
  }
  const narrowed = await forkMcpTerminalLaunch(
    { ...stock, ...(accountEnv ? { accountEnv } : {}) },
    agent,
    {
      workspace: { path: environment.repo.path, connectionId },
      wslDistro,
      shell: resolveStartupShell(host.platform, host.shell),
      settings: environment.settings,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a string-keyed session option record.
      sessionOptions: sessionOptions as Readonly<Record<string, unknown>> | undefined
    }
  )
  return { inputs: { agentArgs: narrowed.agentArgs, sessionOptions }, ...withAccount }
}

/** BAD-815: the account pin reaches only a local, non-WSL pane, so elsewhere the start is refused. */
function assertStartupAccountApplies(
  connectionId: string | null | undefined,
  wslDistro: string | null | undefined
): void {
  const launch = currentForkAgentProfileLaunch()
  const where = connectionId ? 'it runs on a remote host' : wslDistro ? 'it runs inside WSL' : null
  if (where && launch?.account?.kind === 'claude') {
    throw new InvalidArgumentError(
      `Profile "${launch.name}" runs on Claude account ${launch.account.label}, which cannot apply to this new workspace's agent: ${where}. Use a profile without an account there. Nothing was created.`
    )
  }
}
