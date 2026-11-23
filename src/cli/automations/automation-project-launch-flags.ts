import type { AutomationLaunchSetupPatch } from '../../shared/automations/launch/automation-launch-types'
import { getOptionalStringFlagAllowingEmpty } from '../arguments/flags'
import { RuntimeClientError } from '../runtime/connection/types'
import type { RuntimeStatus } from '../../shared/remote-runtime/session-graph/runtime-session-contracts'
import { AUTOMATION_LAUNCH_SETUP_RUNTIME_CAPABILITY } from '../../shared/automations/automation-runtime-capabilities'
import type { RuntimeClient } from '../runtime/client'

/**
 * --model and --effort on a project automation, as a launch setup change. An empty value goes
 * back to the agent's default; undefined when neither flag is given.
 */
export function getProjectLaunchChoicesPatch(
  flags: Map<string, string | boolean>
): Pick<AutomationLaunchSetupPatch, 'choices'> | undefined {
  const model = getOptionalStringFlagAllowingEmpty(flags, 'model')
  const effort = getOptionalStringFlagAllowingEmpty(flags, 'effort')
  if (model === undefined && effort === undefined) {
    return undefined
  }
  if (flags.has('extra-agent-args')) {
    throw new RuntimeClientError(
      'invalid_argument',
      '--model and --effort cannot be combined with --extra-agent-args; put the model and effort in one of them.'
    )
  }
  return {
    choices: {
      ...(model !== undefined ? { model: model || null } : {}),
      ...(effort !== undefined ? { options: { effort: effort || null } } : {})
    }
  }
}

// Older runtimes drop a launch setup change and would run on the agent's default.
export async function assertLaunchChoicesSupported(
  client: RuntimeClient,
  patch: unknown
): Promise<void> {
  if (patch === undefined) {
    return
  }
  const status = await client.call<RuntimeStatus>('status.get')
  if (!status.result.capabilities?.includes(AUTOMATION_LAUNCH_SETUP_RUNTIME_CAPABILITY)) {
    throw new RuntimeClientError(
      'incompatible_runtime',
      "This host's Orca is too old for --model and --effort on a project automation. Update Orca on that host."
    )
  }
}

/**
 * What the create and edit handlers take from --model and --effort, behind one import so the upstream
 * automations.ts stays inside its line limit.
 */
export function forkProjectLaunch(flags: Map<string, string | boolean>): {
  /** Spread into the create params, or the update's, when a launch setup change was asked for. */
  params: { launchSetupPatch?: Pick<AutomationLaunchSetupPatch, 'choices'> }
  assertSupported: (client: RuntimeClient) => Promise<void>
  /** For an edit, once the automation is read: a bot's automation keeps its own agent setup, so it
   *  takes no launch choices; a project's takes them and no --agent. */
  forEdit: (
    client: RuntimeClient,
    flags: Map<string, string | boolean>,
    isBotAutomation: boolean
  ) => Promise<{ launchSetupPatch?: Pick<AutomationLaunchSetupPatch, 'choices'> }>
} {
  const patch = getProjectLaunchChoicesPatch(flags)
  const params = patch ? { launchSetupPatch: patch } : {}
  return {
    params,
    assertSupported: (client) => assertLaunchChoicesSupported(client, patch),
    forEdit: async (client, editFlags, isBotAutomation) => {
      if (isBotAutomation) {
        return {}
      }
      if (editFlags.has('agent')) {
        throw new RuntimeClientError(
          'invalid_argument',
          '--agent needs a bot automation; a project automation takes --provider, with --model and --effort.'
        )
      }
      await assertLaunchChoicesSupported(client, patch)
      return params
    }
  }
}
