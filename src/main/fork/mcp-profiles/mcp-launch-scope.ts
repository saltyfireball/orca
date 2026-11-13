// FORK.md "MCP profiles": which kind of launch created a chat, and the profile asked for. The
// dispatcher runs the launch methods inside a scope (one hook), the automation launcher runs its
// launch inside a background scope (one hook), and chat creation notes the scope it ran in (one
// hook). The chat is created inside the method's awaited chain, so the scope is still current.
import { AsyncLocalStorage } from 'node:async_hooks'
import { InvalidArgumentError } from '../../runtime/rpc/core'
import { FORK_MCP_PROFILE_PARAM, type ForkMcpLaunchKind } from '../../../shared/fork/mcp-profiles'

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

/** Set by the service at install; without it a named profile is ignored, as an older host would. */
export function setForkMcpProfileCheck(check: ((name: string) => boolean) | null): void {
  profileCheck = check
}

/**
 * Dispatcher hook: runs a launch method inside its launch scope. An unknown profile name
 * refuses the launch before anything starts. Other methods run untouched.
 */
export function withForkMcpLaunchScope<T>(
  call: { request: { method: string; params?: unknown } },
  run: () => T
): T {
  const kind = forkMcpLaunchKindOfMethod(call.request.method)
  if (!kind) {
    return run()
  }
  const profile = forkMcpProfileParamOf(call.request.params)
  if (profile && profileCheck && !profileCheck(profile)) {
    throw new InvalidArgumentError(
      `Unknown MCP profile "${profile}". See \`orca mcp-profile list\` for this host's profiles.`
    )
  }
  return runInForkMcpLaunchScope({ kind, ...(profile ? { profile } : {}) }, run)
}
