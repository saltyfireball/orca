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
