import type { AutomationLaunchSetupPatch } from '../../shared/automations/launch/automation-launch-types'
import { getOptionalStringFlagAllowingEmpty } from '../arguments/flags'
import { RuntimeClientError } from '../runtime/connection/types'
import type { RuntimeStatus } from '../../shared/remote-runtime/session-graph/runtime-session-contracts'
import {
  AUTOMATION_FORK_MCP_PROFILE_RUNTIME_CAPABILITY,
  AUTOMATION_LAUNCH_SETUP_RUNTIME_CAPABILITY
} from '../../shared/automations/automation-runtime-capabilities'
import { FORK_MCP_PROFILE_ALL, FORK_MCP_PROFILE_PARAM } from '../../shared/fork/mcp-profiles'
import { FORK_MCP_PROFILE_FLAG } from '../fork/mcp-profile-specs'
import type { RuntimeClient } from '../runtime/client'
import { FORK_AGENT_PROFILE_PERMISSION_MODES } from '../../shared/fork/agent-profiles/agent-profiles-types'
import { FORK_AGENT_PROFILE_PERMISSION_FLAG } from '../fork/agent-profile-flag'

function forkProfilePermissionChoice(flags: Map<string, string | boolean>) {
  const value = flags.get(FORK_AGENT_PROFILE_PERMISSION_FLAG)
  return FORK_AGENT_PROFILE_PERMISSION_MODES.find((mode) => mode === value)
}

/**
 * --model and --effort on a project automation, as a launch setup change. An empty value goes
 * back to the agent's default; undefined when neither flag is given.
 */
export function getProjectLaunchChoicesPatch(
  flags: Map<string, string | boolean>
): Pick<AutomationLaunchSetupPatch, 'choices'> | undefined {
  const model = getOptionalStringFlagAllowingEmpty(flags, 'model')
  const effort = getOptionalStringFlagAllowingEmpty(flags, 'effort')
  // BAD-741: a --profile's permission mode, already capped by the host (FORK.md "Agent profiles").
  const permissionMode = forkProfilePermissionChoice(flags)
  if (model === undefined && effort === undefined && !permissionMode) {
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
      ...(effort !== undefined ? { options: { effort: effort || null } } : {}),
      ...(permissionMode ? { permissionMode } : {})
    }
  }
}

/** BAD-800: a `--profile`'s MCP profile, which the host stores on the automation for every run. */
function forkProfileMcpParam(flags: Map<string, string | boolean>): {
  [FORK_MCP_PROFILE_PARAM]?: string
} {
  const value = flags.get(FORK_MCP_PROFILE_FLAG)
  return typeof value === 'string' && value.trim() && value.trim() !== FORK_MCP_PROFILE_ALL
    ? { [FORK_MCP_PROFILE_PARAM]: value.trim() }
    : {}
}

// Older runtimes drop a launch setup change and would run on the agent's default.
export async function assertLaunchChoicesSupported(
  client: RuntimeClient,
  patch: unknown,
  mcpProfile?: string
): Promise<void> {
  if (patch === undefined && mcpProfile === undefined) {
    return
  }
  const status = await client.call<RuntimeStatus>('status.get')
  const capabilities = status.result.capabilities ?? []
  if (patch !== undefined && !capabilities.includes(AUTOMATION_LAUNCH_SETUP_RUNTIME_CAPABILITY)) {
    throw new RuntimeClientError(
      'incompatible_runtime',
      "This host's Orca is too old for --model and --effort on a project automation. Update Orca on that host."
    )
  }
  // An older host drops the MCP profile and every run would load every server.
  if (mcpProfile && !capabilities.includes(AUTOMATION_FORK_MCP_PROFILE_RUNTIME_CAPABILITY)) {
    throw new RuntimeClientError(
      'incompatible_runtime',
      `This host's Orca cannot keep MCP profile "${mcpProfile}" on an automation, so its runs would load every server. Update Orca on that host, or use a profile without an MCP profile. Nothing was created.`
    )
  }
}

/**
 * What the create and edit handlers take from --model and --effort, behind one import so the upstream
 * automations.ts stays inside its line limit.
 */
export function forkProjectLaunch(flags: Map<string, string | boolean>): {
  /** Spread into the create params, or the update's, when a launch setup change was asked for. */
  params: {
    launchSetupPatch?: Pick<AutomationLaunchSetupPatch, 'choices'>
    [FORK_MCP_PROFILE_PARAM]?: string
  }
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
  const mcp = forkProfileMcpParam(flags)
  const params = { ...(patch ? { launchSetupPatch: patch } : {}), ...mcp }
  return {
    params,
    assertSupported: (client) =>
      assertLaunchChoicesSupported(client, patch, mcp[FORK_MCP_PROFILE_PARAM]),
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
      return patch ? { launchSetupPatch: patch } : {}
    }
  }
}
