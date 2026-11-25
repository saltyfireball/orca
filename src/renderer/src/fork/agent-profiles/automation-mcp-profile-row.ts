// FORK.md "Agent profiles" (BAD-800): the automation card names the MCP profile its runs keep.
import type { Translate } from '@/i18n/use-translate'
import type { Automation } from '../../../../shared/automations/automation-definition'
import { isForkMcpRetiredAutomationKey } from '../../../../shared/fork/mcp-profiles'

export function automationMcpProfileProperties(
  automation: Pick<Automation, 'forkMcpProfile' | 'creationKey'>,
  t: Translate
): { key: string; label: string; value: string; title?: string }[] {
  const label = t('fork.agentProfiles.automationMcpProfile', 'MCP profile')
  if (automation.forkMcpProfile) {
    return [
      {
        key: 'fork-mcp-profile',
        label,
        value: automation.forkMcpProfile,
        title: t(
          'fork.agentProfiles.automationMcpProfileTitle',
          'Every run loads only the servers of this MCP profile, and is refused if the profile is gone.'
        )
      }
    ]
  }
  return isForkMcpRetiredAutomationKey(automation.creationKey)
    ? [
        {
          key: 'fork-mcp-profile',
          label,
          value: t(
            'fork.agentProfiles.automationMcpProfileLost',
            'Lost: made by an earlier Orca, its runs are refused. Create it again with --profile.'
          )
        }
      ]
    : []
}
