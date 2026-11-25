// FORK.md "Agent profiles" (BAD-800): `orca automations show` names the MCP profile an automation
// keeps, so a person can see which servers its runs load.
import type { Automation } from '../../shared/automations/automation-definition'
import { isForkMcpRetiredAutomationKey } from '../../shared/fork/mcp-profiles'

export function forkAutomationMcpProfileLines(
  automation: Pick<Automation, 'forkMcpProfile' | 'creationKey'>
): string[] {
  if (automation.forkMcpProfile) {
    return [
      `mcp profile: ${automation.forkMcpProfile} (every run loads only its servers; a run is refused if it is gone)`
    ]
  }
  return isForkMcpRetiredAutomationKey(automation.creationKey)
    ? [
        'mcp profile: lost (made by an earlier Orca; its runs are refused, create it again with --profile)'
      ]
    : []
}
