// Snooze (FORK.md, SLRM-2269): the workspace menu's "Snooze..." submenu, or "Wake" when the
// workspace is snoozed. Hidden while snooze is off.
import React from 'react'
import { Moon } from 'lucide-react'
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { useTranslate } from '@/i18n/use-translate'
import {
  forkSnoozeHostId,
  forkSnoozeWorkspaceKey,
  type ForkSnoozeTarget
} from '../../../../shared/fork/snooze'
import { wakeForkSnooze } from './snooze-client'
import { useForkSnoozeEntries, useForkSnoozeSettings } from './use-fork-snooze'
import { ForkSnoozeChoices } from './ForkSnoozeChoices'

export function ForkSnoozeWorktreeMenuItem({
  worktree,
  disabled
}: {
  worktree: { id: string; hostId?: string | null; displayName: string }
  disabled?: boolean
}): React.JSX.Element | null {
  const t = useTranslate()
  const { enabled } = useForkSnoozeSettings()
  const entries = useForkSnoozeEntries()
  if (!enabled) {
    return null
  }
  const key = forkSnoozeWorkspaceKey(worktree.id, worktree.hostId)
  const snoozed = entries.find(
    (entry) =>
      entry.target.kind === 'workspace' &&
      forkSnoozeWorkspaceKey(entry.target.worktreeId, entry.target.hostId) === key
  )
  if (snoozed) {
    return (
      <DropdownMenuItem
        disabled={disabled}
        onSelect={() => void wakeForkSnooze(snoozed.id, 'manual')}
      >
        <Moon className="size-3.5" />
        {t('fork.snooze.menu.wake', 'Wake')}
      </DropdownMenuItem>
    )
  }
  const target: ForkSnoozeTarget = {
    kind: 'workspace',
    worktreeId: worktree.id,
    hostId: forkSnoozeHostId(worktree.hostId)
  }
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={disabled}>
        <Moon className="size-3.5" />
        {t('fork.snooze.menu.snooze', 'Snooze...')}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-56">
        <ForkSnoozeChoices target={target} label={worktree.displayName} disabled={disabled} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
