// FORK.md "Agent profiles" (BAD-800): the MCP profile an automation was created with
// (`automations create --profile`, or a move that carries it) is kept on the automation record
// (`forkMcpProfile`), so every copy of the record keeps it and nothing links it by a key. Every run
// checks it again by name: a profile changed since applies as it is now, a deleted one, another
// agent or a host without MCP profiles refuses the run. Nothing here is set by default.
import {
  FORK_MCP_PROFILE_ALL,
  isForkMcpRetiredAutomationKey
} from '../../../shared/fork/mcp-profiles'
import { InvalidArgumentError } from '../../runtime/rpc/core'
import {
  assertForkMcpProfileApplies,
  assertForkMcpProfileKnown,
  forkMcpProfileParamOf,
  runInForkMcpLaunchScope
} from './mcp-launch-scope'
import { runInForkAutomationCreateScope } from './mcp-automation-create-scope'

type AutomationCreateCall = {
  request: { method: string; params?: unknown }
  params?: unknown
}

/**
 * Dispatcher hook for `automation.create`: the MCP profile the call names is checked, then the
 * create runs in a scope the store's write reads, so the automation is written with it. A bot
 * automation, another agent or a profile this host lacks is refused with nothing created.
 */
export async function withForkAutomationMcpProfile<T>(
  call: AutomationCreateCall,
  run: () => T
): Promise<Awaited<T>> {
  const profile = forkMcpProfileParamOf(call.request.params)
  if (!profile || profile === FORK_MCP_PROFILE_ALL) {
    return await run()
  }
  const params = fieldsOf(call.params)
  const refused = `MCP profile "${profile}" cannot be stored on this automation: `
  if (params.bot) {
    throw new InvalidArgumentError(
      `${refused}a bot automation runs in the bot's own chat. Nothing was created.`
    )
  }
  assertForkMcpProfileKnown(profile, refused)
  assertForkMcpProfileApplies(profile, {
    agent: typeof params.agentId === 'string' ? params.agentId : undefined
  })
  const result = await runInForkAutomationCreateScope(profile, run)
  if (fieldsOf(fieldsOf(result).automation).forkMcpProfile !== profile) {
    // A retried create key that found an automation saved without it, or a write that lost it.
    throw new InvalidArgumentError(
      `${refused}an automation with this creation key already exists without it. Delete that automation, or create this one with another key.`
    )
  }
  return result
}

/** An object's own fields, or none for anything else. */
function fieldsOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? { ...value } : {}
}

type LaunchedAutomation = {
  name: string
  agentId: string
  creationKey?: string
  forkMcpProfile?: string
}

/**
 * The automation launchers' hook: a run of an automation that keeps an MCP profile launches in the
 * background scope with that profile, checked by name as it is now. A deleted profile, another
 * agent or a host without MCP profiles refuses the run with the reason; it never runs wider.
 */
export function forkAutomationMcpLaunch<T>(
  automation: LaunchedAutomation,
  run: () => Promise<T>
): Promise<T> {
  const profile = automation.forkMcpProfile
  if (!profile) {
    return isForkMcpRetiredAutomationKey(automation.creationKey)
      ? Promise.reject(
          new Error(
            `Automation "${automation.name}" did not run: it was created by an earlier Orca that kept its MCP profile apart from it, so Orca cannot tell which servers it may load. Create it again with --profile.`
          )
        )
      : run()
  }
  try {
    assertForkMcpProfileKnown(profile, `Automation "${automation.name}" did not run: `)
    assertForkMcpProfileApplies(profile, { agent: automation.agentId })
  } catch (error) {
    return Promise.reject(error)
  }
  return runInForkMcpLaunchScope({ kind: 'background', profile }, run)
}

/** The one-line hook form: a launcher whose runs go through `forkAutomationMcpLaunch`. */
export function forkMcpLaunched<R, Q extends { automation: LaunchedAutomation }, T>(
  launcher: (runtime: R, request: Q) => Promise<T>
): (runtime: R, request: Q) => Promise<T> {
  return (runtime, request) =>
    forkAutomationMcpLaunch(request.automation, () => launcher(runtime, request))
}
