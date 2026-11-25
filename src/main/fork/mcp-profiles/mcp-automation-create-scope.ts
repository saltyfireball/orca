// FORK.md "Agent profiles" (BAD-800): the MCP profile an `automation.create` call keeps, handed from
// the dispatcher hook to the store's write so it lands on the automation record itself.
import { AsyncLocalStorage } from 'node:async_hooks'

const scope = new AsyncLocalStorage<string>()

export function runInForkAutomationCreateScope<T>(profile: string, run: () => T): T {
  return scope.run(profile, run)
}

/** Spread into a new automation: the MCP profile its create call was checked for, if any. */
export function forkAutomationCreateMcpProfile(): { forkMcpProfile?: string } {
  const profile = scope.getStore()
  return profile ? { forkMcpProfile: profile } : {}
}
