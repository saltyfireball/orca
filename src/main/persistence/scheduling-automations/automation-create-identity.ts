import type {
  Automation,
  AutomationCreateInput
} from '../../../shared/automations/automation-definition'
import { forkAutomationCreateMcpProfile } from '../../fork/mcp-profiles/mcp-automation-create-scope'

/** The fields a new automation keeps from how it was asked for: its retry key and its creator. */
export function automationCreateIdentity(
  input: Pick<AutomationCreateInput, 'creationKey' | 'createdBy'>
): Pick<Automation, 'creationKey' | 'createdBy' | 'forkMcpProfile'> {
  return {
    ...(input.creationKey ? { creationKey: input.creationKey } : {}),
    ...(input.createdBy ? { createdBy: input.createdBy } : {}),
    // Fork (BAD-800): the MCP profile its create call was checked for, kept on the record.
    ...forkAutomationCreateMcpProfile()
  }
}
