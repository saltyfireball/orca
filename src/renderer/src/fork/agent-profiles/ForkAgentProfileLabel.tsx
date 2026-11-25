// FORK.md "Agent profiles" (BAD-741): one profile in a menu: its name, its note, and what will not
// apply as asked (an unconfirmed preamble, a capped mode, an account a UI start does not choose,
// an MCP limit a UI start cannot carry).
import React from 'react'
import { useTranslate } from '@/i18n/use-translate'
import type { ForkAgentProfilePick } from './agent-profile-picks'

export function ForkAgentProfileLabel({
  pick,
  unavailable
}: {
  pick: ForkAgentProfilePick
  unavailable?: boolean
}): React.JSX.Element {
  const t = useTranslate()
  const { profile } = pick
  const hint = pick.needsConfirm
    ? t(
        'fork.agentProfiles.needsConfirm',
        'Confirm its preamble first: orca profiles confirm {{name}}',
        {
          name: profile.name
        }
      )
    : unavailable
      ? t('fork.agentProfiles.unavailable', '{{agent}} cannot start here', { agent: profile.agent })
      : pick.mcpLimit
        ? t(
            'fork.agentProfiles.mcpLimitCli',
            'MCP profile {{mcp}} applies only from the CLI: orca agent launch --profile {{name}}',
            { mcp: pick.mcpLimit, name: profile.name }
          )
        : [
            pick.capped
              ? t('fork.agentProfiles.capped', 'Permission lowered to {{mode}} by Settings', {
                  mode: pick.permissionMode
                })
              : null,
            profile.account
              ? t('fork.agentProfiles.accountNotUsed', 'Runs on the selected account')
              : null
          ]
            .filter(Boolean)
            .join(', ')
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="truncate">{profile.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {[profile.agent, profile.model].filter(Boolean).join(', ')}
        </span>
      </span>
      {profile.whenToUse ? (
        <span className="truncate text-xs text-muted-foreground">{profile.whenToUse}</span>
      ) : null}
      {hint ? <span className="truncate text-xs text-muted-foreground">{hint}</span> : null}
    </span>
  )
}
