// FORK.md "Agent profiles" (BAD-741): the + menu's profiles, after the agents. Picking one starts
// its agent with the profile's model, effort and capped permission mode, its preamble as the first
// prompt. One with an MCP limit is shown but cannot start here (BAD-800). Nothing shows until a
// profile exists.
import React from 'react'
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import {
  agentMenuRowReady,
  type NewTabAgentMenuRow
} from '../../../../shared/agent-launch/picker/agent-launch-picker-rows'
import type { NewTabAgentMenuModel } from '@/components/agent/launch-menu/new-tab-agent-menu-model'
import type { TabAgentLaunchOption } from '@/components/tab-bar/create-entry/tab-agent-launch-options'
import {
  forkAgentProfileLaunchDraft,
  forkAgentProfilePicks,
  type ForkAgentProfilePick
} from './agent-profile-picks'
import { ForkAgentProfileLabel } from './ForkAgentProfileLabel'

export function forkAgentProfileRow(
  model: NewTabAgentMenuModel,
  pick: ForkAgentProfilePick
): NewTabAgentMenuRow | undefined {
  if (model.state !== 'settled') {
    return undefined
  }
  const rows = model.rows.filter(
    (row) => row.agent === pick.profile.agent && agentMenuRowReady(row)
  )
  return rows.find((row) => row.kind === 'chat') ?? rows[0]
}

export function ForkAgentProfileMenuItems({
  model,
  onLaunch
}: {
  model: NewTabAgentMenuModel
  onLaunch: (option: TabAgentLaunchOption) => unknown
}): React.JSX.Element | null {
  const t = useTranslate()
  const settings = useAppStore((state) => state.settings)
  const picks = forkAgentProfilePicks(settings)
  if (picks.length === 0) {
    return null
  }
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>{t('fork.agentProfiles.menuLabel', 'Profiles')}</DropdownMenuLabel>
      {picks.map((pick) => {
        const row = forkAgentProfileRow(model, pick)
        const setup = forkAgentProfileLaunchDraft(pick, row?.kind === 'chat' ? 'chat' : 'terminal')
        return (
          <DropdownMenuItem
            key={pick.profile.name}
            variant="create"
            disabled={!row || !setup || pick.needsConfirm}
            onSelect={() =>
              row &&
              setup &&
              onLaunch({
                agent: pick.profile.agent,
                aliases: [],
                label: pick.profile.name,
                row,
                setup
              })
            }
          >
            <ForkAgentProfileLabel pick={pick} unavailable={!row} />
          </DropdownMenuItem>
        )
      })}
    </>
  )
}
