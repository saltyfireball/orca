// FORK.md "Agent profiles" (BAD-741): a `--profile` launch runs in a scope that holds what the
// profile applies on this host. The dispatcher enters it for the launch methods (through the MCP
// profile scope's hook); the terminal plan, chat creation and the worker preamble read it (one hook
// each). It is resolved here, from this host's own settings, so the permission cap and the account
// check are this host's. A paired server gets the home's resolution as a wire field and checks it
// against its own settings and accounts; it refuses what it cannot honor, never drops it.
import { AsyncLocalStorage } from 'node:async_hooks'
import { InvalidArgumentError } from '../../runtime/rpc/core'
import {
  forkAgentProfileMaxPermission,
  forkAgentProfilePermissionRank as rank,
  resolveForkAgentProfile
} from '../../../shared/fork/agent-profiles/agent-profiles-resolve'
import {
  FORK_AGENT_PROFILE_PARAM,
  type ForkAgentProfilePermissionMode
} from '../../../shared/fork/agent-profiles/agent-profiles-types'
import {
  FORK_AGENT_PROFILE_LAUNCH_PARAM,
  ForkAgentProfileLaunchWire
} from '../../../shared/fork/agent-profiles/agent-profile-launch'
import { getClaudeProfileRouter } from '../../claude-accounts/profiles/routing/claude-profile-installed-router'
import {
  resolveForkProfileAccount,
  type ForkProfileAccountPlan,
  type ForkAgentProfileHostSettings,
  type ForkProfileAccountRouter
} from './agent-profile-account'

export type ForkAgentProfileLaunch = {
  name: string
  agent: string
  permissionMode?: ForkAgentProfilePermissionMode
  /** Checked on this host; unset where the launch runs on a paired server. */
  account?: ForkProfileAccountPlan
  preamble?: string
  /** What a start placed on a paired server sends it; set only for such a start. */
  carry?: ForkAgentProfileLaunchWire
}

type Deps = {
  readSettings: () => ForkAgentProfileHostSettings | undefined
  claudeRouter: () => ForkProfileAccountRouter | undefined
}

const scope = new AsyncLocalStorage<ForkAgentProfileLaunch>()
let deps: Deps = { readSettings: () => undefined, claudeRouter: () => getClaudeProfileRouter() }

export function installForkAgentProfileLaunch(next: Partial<Deps>): void {
  deps = { ...deps, ...next }
}

/** The methods that start agents, and the request field naming the agent each starts. */
const LAUNCH_METHODS: Readonly<Record<string, string>> = {
  'agent.launch': 'agent',
  'agent.launchReplay': 'agent',
  'worktree.create': 'startupAgent',
  'orchestration.workerStart': 'agent',
  'orchestration.federationAttachStart': 'agent'
}

export function currentForkAgentProfileLaunch(): ForkAgentProfileLaunch | undefined {
  return scope.getStore()
}

export function runInForkAgentProfileLaunch<T>(launch: ForkAgentProfileLaunch, run: () => T): T {
  return scope.run(launch, run)
}

function field(params: Record<string, unknown>, name: string): string | undefined {
  const value = params[name]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isParams(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function checkAccount(
  agent: string,
  account: string | undefined,
  settings: ForkAgentProfileHostSettings
): ForkProfileAccountPlan | undefined {
  if (!account) {
    return undefined
  }
  const checked = resolveForkProfileAccount(agent, account, settings, deps.claudeRouter())
  if (!checked.ok) {
    throw new InvalidArgumentError(checked.message)
  }
  return checked.plan
}

/** A profile named by the CLI, resolved from this host's settings. */
function fromName(
  name: string,
  agent: string | undefined,
  params: Record<string, unknown>,
  settings: ForkAgentProfileHostSettings
): ForkAgentProfileLaunch {
  const resolution = resolveForkAgentProfile({
    settings,
    name,
    ...(agent ? { explicit: { agent } } : {})
  })
  if (!resolution.ok) {
    throw new InvalidArgumentError(resolution.message)
  }
  const { resolved } = resolution
  const remote = field(params, 'on') !== undefined
  const base = {
    name: resolved.name,
    agent: resolved.agent,
    ...(resolved.permissionMode ? { permissionMode: resolved.permissionMode } : {}),
    ...(resolved.preamble ? { preamble: resolved.preamble } : {})
  }
  if (remote) {
    // The server that runs it checks the account and its own permission policy.
    return {
      ...base,
      carry: { ...base, ...(resolved.account ? { account: resolved.account } : {}) }
    }
  }
  const account = checkAccount(resolved.agent, resolved.account, settings)
  return { ...base, ...(account ? { account } : {}) }
}

/** A profile a home resolved and sent here: this server's policy and accounts still decide. */
function fromWire(
  raw: unknown,
  agent: string | undefined,
  settings: ForkAgentProfileHostSettings
): ForkAgentProfileLaunch {
  const parsed = ForkAgentProfileLaunchWire.safeParse(raw)
  if (!parsed.success) {
    throw new InvalidArgumentError('The agent profile this start carries is malformed.')
  }
  const wire = parsed.data
  const launchAgent = agent ?? wire.agent
  if (wire.permissionMode) {
    const max = forkAgentProfileMaxPermission(settings, launchAgent)
    if (rank(wire.permissionMode) > rank(max)) {
      throw new InvalidArgumentError(
        `Profile "${wire.name}" asks for permission mode ${wire.permissionMode}, wider than this computer's Settings allow for ${launchAgent} (${max}). Nothing was started.`
      )
    }
  }
  const account = checkAccount(launchAgent, wire.account, settings)
  return {
    name: wire.name,
    agent: launchAgent,
    ...(wire.permissionMode ? { permissionMode: wire.permissionMode } : {}),
    ...(account ? { account } : {}),
    ...(wire.preamble ? { preamble: wire.preamble } : {})
  }
}

/**
 * Dispatcher hook: runs a launch method that names a profile inside its scope. An unknown,
 * unconfirmed or unusable profile, a signed-out or missing account, and a mode this server does
 * not allow refuse the call before anything starts. Every other call runs untouched.
 */
export function withForkAgentProfileLaunchScope<T>(
  call: { request: { method: string; params?: unknown } },
  run: () => T
): T {
  const agentField = Object.hasOwn(LAUNCH_METHODS, call.request.method)
    ? LAUNCH_METHODS[call.request.method]
    : undefined
  const values = call.request.params
  if (!agentField || !isParams(values)) {
    return run()
  }
  const wire = values[FORK_AGENT_PROFILE_LAUNCH_PARAM]
  const name = field(values, FORK_AGENT_PROFILE_PARAM)
  if (wire === undefined && !name) {
    return run()
  }
  const settings = deps.readSettings() ?? {}
  const agent = field(values, agentField)
  const launch =
    wire !== undefined ? fromWire(wire, agent, settings) : fromName(name!, agent, values, settings)
  if (
    call.request.method === 'orchestration.workerStart' &&
    field(values, 'terminal') &&
    (launch.permissionMode || launch.account || launch.carry?.account)
  ) {
    throw new InvalidArgumentError(
      `Profile "${launch.name}" sets a permission mode or account, which a worker reusing --terminal cannot take: that agent is already running. Start a new worker instead. Nothing was started.`
    )
  }
  return scope.run(launch, run)
}
