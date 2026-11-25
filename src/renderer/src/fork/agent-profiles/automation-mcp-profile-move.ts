// FORK.md "Agent profiles" (BAD-800): moving an automation to another host is a new create there,
// so the MCP profile the original keeps goes with it, and a host that cannot keep it refuses the
// move before anything is created (the original stays as it is).
import type {
  Automation,
  AutomationCreateInput
} from '../../../../shared/automations/automation-definition'
import type { AutomationAuthorityRef } from '../../../../shared/automations/ownership/automation-owner-ref'
import { AUTOMATION_FORK_MCP_PROFILE_RUNTIME_CAPABILITY } from '../../../../shared/automations/automation-runtime-capabilities'
import { assertAuthorityCapability } from '../../components/automations/hosts/automation-capability-probe'

/** Spread into a move's create input: the source's MCP profile, which the destination checks. */
export function forkAutomationMcpProfileCarry(
  source: Pick<Automation, 'forkMcpProfile'>
): Pick<AutomationCreateInput, 'forkMcpProfile'> {
  return source.forkMcpProfile ? { forkMcpProfile: source.forkMcpProfile } : {}
}

/** An older host drops the param and every run would load every server, so it is refused. */
export async function assertForkAutomationMcpProfileSupported(
  authority: AutomationAuthorityRef,
  input: Pick<AutomationCreateInput, 'forkMcpProfile'>
): Promise<void> {
  if (!input.forkMcpProfile) {
    return
  }
  await assertAuthorityCapability(
    authority,
    AUTOMATION_FORK_MCP_PROFILE_RUNTIME_CAPABILITY,
    `This automation keeps MCP profile "${input.forkMcpProfile}", and that host's Orca cannot keep it, so its runs would load every server. Update Orca on that host. Nothing was moved.`
  )
}
