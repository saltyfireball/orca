// SLRM-2265 (FORK.md "Worktree move"): the workspace menu's "Move to Host" submenu. It lists this
// machine and each paired server other than the workspace's own host; a pick opens the confirm
// dialog. Hidden when the setting turns the menu item off.
import React from 'react'
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import { translateLocalExecutionHostLabel } from '@/components/sidebar/execution-host-label'
import { resolveWorktreeMoveSettings } from '../../../../shared/fork/worktree-move/worktree-move-settings'
import { worktreeMoveHostChoices, worktreeMoveSourceHostId } from './worktree-move-client'
import { openForkWorktreeMoveDialog } from './ForkWorktreeMoveDialog'

export function ForkMoveWorktreeMenuItem({
  worktreeId,
  disabled
}: {
  worktreeId: string
  disabled?: boolean
}): React.JSX.Element | null {
  const t = useTranslate()
  const enabled = useAppStore((s) => resolveWorktreeMoveSettings(s.settings?.forkWorktreeMove).menu)
  const environments = useAppStore((s) => s.runtimeEnvironments)
  const sourceHostId = useAppStore((s) => worktreeMoveSourceHostId(s, worktreeId))
  if (!enabled) {
    return null
  }
  const choices = worktreeMoveHostChoices(
    environments,
    sourceHostId,
    translateLocalExecutionHostLabel()
  )
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={disabled || !sourceHostId}>
        {t('fork.worktreeMove.menu', 'Move to Host')}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {choices.length === 0 ? (
          <DropdownMenuItem disabled>
            {t('fork.worktreeMove.noHosts', 'No other hosts. Pair an Orca server first.')}
          </DropdownMenuItem>
        ) : (
          choices.map((choice) => (
            <DropdownMenuItem
              key={choice.hostId}
              disabled={disabled}
              onSelect={() =>
                openForkWorktreeMoveDialog({
                  worktreeId,
                  targetHostId: choice.hostId,
                  targetLabel: choice.label
                })
              }
            >
              <span className="max-w-48 truncate">{choice.label}</span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
