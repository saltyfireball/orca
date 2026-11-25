// FORK.md "MCP profiles": which kind of launch created a chat, and the profile asked for. The
// dispatcher runs the launch methods inside a scope (one hook), the automation launcher runs its
// launch inside a background scope (one hook), and chat creation notes the scope it ran in (one
// hook). The chat is created inside the method's awaited chain, so the scope is still current.
import { AsyncLocalStorage } from 'node:async_hooks'
import { InvalidArgumentError } from '../../runtime/rpc/core'
import {
  FORK_MCP_PROFILE_ALL,
  FORK_MCP_PROFILE_PARAM,
  type ForkMcpLaunchKind
} from '../../../shared/fork/mcp-profiles'
import { withForkAgentProfileLaunchScope } from '../agent-profiles/agent-profile-launch-scope'
import { withForkAutomationMcpProfile } from './mcp-automation-profiles'

export type ForkMcpLaunchScope = { kind: ForkMcpLaunchKind; profile?: string }

const scope = new AsyncLocalStorage<ForkMcpLaunchScope>()

/** Methods that create chats, and the kind of launch each one is. */
const LAUNCH_METHODS: Readonly<Record<string, ForkMcpLaunchKind>> = {
  'agent.launch': 'interactive',
  'agent.launchReplay': 'interactive',
  'worktree.create': 'interactive',
  'orchestration.workerStart': 'worker'
}

export function forkMcpLaunchKindOfMethod(method: string): ForkMcpLaunchKind | undefined {
  return Object.hasOwn(LAUNCH_METHODS, method) ? LAUNCH_METHODS[method] : undefined
}

export function currentForkMcpLaunchScope(): ForkMcpLaunchScope | undefined {
  return scope.getStore()
}

/** Reads the CLI's profile param from the raw request; the method's own schema drops it. */
export function forkMcpProfileParamOf(rawParams: unknown): string | undefined {
  if (!rawParams || typeof rawParams !== 'object') {
    return undefined
  }
  const value = (rawParams as Record<string, unknown>)[FORK_MCP_PROFILE_PARAM]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * Runs `run` in the scope for `kind`. A launch nested in another keeps the outer kind (a worker
 * start that goes through agent.launch is still a worker) and the outer profile unless it names
 * its own.
 */
export function runInForkMcpLaunchScope<T>(next: ForkMcpLaunchScope, run: () => T): T {
  const outer = scope.getStore()
  const merged: ForkMcpLaunchScope = outer
    ? {
        kind: outer.kind,
        ...((next.profile ?? outer.profile) ? { profile: next.profile ?? outer.profile } : {})
      }
    : next
  return scope.run(merged, run)
}

let profileCheck: ((name: string) => boolean) | null = null

/** Set by the service at install; without it a named profile is refused (BAD-741). */
export function setForkMcpProfileCheck(check: ((name: string) => boolean) | null): void {
  profileCheck = check
}

/** The request field naming the agent each launch method starts. */
const AGENT_FIELDS: Readonly<Record<string, string>> = {
  'agent.launch': 'agent',
  'agent.launchReplay': 'agent',
  'worktree.create': 'startupAgent',
  'orchestration.workerStart': 'agent'
}

/**
 * BAD-741: an MCP profile narrows only Claude's servers. A launch of another agent that names one
 * is refused with the reason instead of running with every server.
 */
export function assertForkMcpProfileApplies(
  profile: string | undefined,
  where: { agent?: string }
): void {
  if (profile && profile !== FORK_MCP_PROFILE_ALL && where.agent && where.agent !== 'claude') {
    throw new InvalidArgumentError(
      `MCP profile "${profile}" applies only to Claude, and ${where.agent} takes none. Start it without the MCP profile. Nothing was started.`
    )
  }
}

/**
 * BAD-741: a worker start that reuses an existing terminal launches nothing, so an MCP profile it
 * names (or a Task's stored one) would be dropped; it is refused before anything is created.
 */
export function assertForkMcpProfileNotForExistingTerminal(
  profile: string | undefined,
  terminal: string | undefined
): void {
  if (profile && profile !== FORK_MCP_PROFILE_ALL && terminal) {
    throw new InvalidArgumentError(
      `MCP profile "${profile}" cannot apply to --terminal: that agent is already running. Start a new worker instead. Nothing was started.`
    )
  }
}

/** Refuses an MCP profile this host does not have, before anything starts. */
export function assertForkMcpProfileKnown(profile: string, refusedBecause = ''): void {
  if (!profileCheck && profile !== FORK_MCP_PROFILE_ALL) {
    // BAD-741: a host that has not loaded MCP profiles (headless orcad) would drop it.
    throw new InvalidArgumentError(
      `${refusedBecause}MCP profiles are not loaded on this computer, so MCP profile "${profile}" cannot apply. Start it without the MCP profile. Nothing was started.`
    )
  }
  if (profileCheck && !profileCheck(profile)) {
    throw new InvalidArgumentError(
      `${refusedBecause}Unknown MCP profile "${profile}". See \`orca mcp-profile list\` for this host's profiles.`
    )
  }
}

/**
 * Dispatcher hook: runs a launch method inside its launch scope. An unknown profile name
 * refuses the launch before anything starts. Other methods run untouched.
 */
export function withForkMcpLaunchScope<T>(
  call: { request: { method: string; params?: unknown }; params?: unknown },
  run: () => T
): T {
  if (call.request.method === 'automation.create') {
    // BAD-800: an automation keeps a --profile's MCP profile on its record for every run. Its
    // result is the handler's promise either way, which the dispatcher awaits.
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the dispatcher's `run` is the async method handler, so T is already a promise of the same result.
    return withForkAutomationMcpProfile(call, run) as T
  }
  // BAD-741: a --profile launch's own scope (FORK.md "Agent profiles") rides the same hook.
  return withForkAgentProfileLaunchScope(call, () => mcpLaunchScope(call, run))
}

function mcpLaunchScope<T>(
  call: { request: { method: string; params?: unknown } },
  run: () => T
): T {
  const kind = forkMcpLaunchKindOfMethod(call.request.method)
  if (!kind) {
    return run()
  }
  const profile = forkMcpProfileParamOf(call.request.params)
  if (profile) {
    const params: Record<string, unknown> = Object.fromEntries(
      Object.entries(call.request.params ?? {})
    )
    const text = (name: string | undefined): string | undefined => {
      const value = name ? params[name] : undefined
      return typeof value === 'string' && value.trim() ? value.trim() : undefined
    }
    if (call.request.method === 'orchestration.workerStart') {
      assertForkMcpProfileNotForExistingTerminal(profile, text('terminal'))
    }
    // A start placed on a paired server is checked against that server's profiles.
    if (call.request.method !== 'orchestration.workerStart' || !text('on')) {
      assertForkMcpProfileKnown(profile)
    }
    assertForkMcpProfileApplies(profile, { agent: text(AGENT_FIELDS[call.request.method]) })
  }
  return runInForkMcpLaunchScope({ kind, ...(profile ? { profile } : {}) }, run)
}
