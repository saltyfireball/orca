// Snooze (FORK.md, SLRM-2269): a right-click menu on a sidebar agent row (a chat or a terminal
// agent) with the snooze choices. Its own context menu scope, so the workspace card's menu leaves
// the row's right-click to it. Child rows and a switched-off snooze render the row as it is.
import React, { useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import { findWorktreeById } from '@/store/github/refresh/worktree-refresh'
import { WORKTREE_CONTEXT_MENU_SCOPE_ATTR } from '@/components/sidebar/workspace-actions/context-menu/worktree-context-menu-policy'
import { CLOSE_ALL_CONTEXT_MENUS_EVENT } from '@/lib/overlay-interaction/close-all-context-menus'
import type { DashboardAgentRow } from '@/components/dashboard/rows/dashboard-agent-row'
import { getAgentRowPrimaryText } from '../../../../shared/agent-status/presentation/agent-row-primary-text'
import { formatAgentTypeLabel } from '../../../../shared/agent-status/presentation/agent-type-label'
import { forkSnoozeHostId, type ForkSnoozeTarget } from '../../../../shared/fork/snooze'
import { useForkSnoozeSettings } from './use-fork-snooze'
import { ForkSnoozeChoices } from './ForkSnoozeChoices'

export function forkAgentRowLabel(row: Pick<DashboardAgentRow, 'entry' | 'agentType'>): string {
  const text = getAgentRowPrimaryText(row.entry).replace(/\s+/g, ' ').trim()
  return (text || formatAgentTypeLabel(row.agentType)).slice(0, 80)
}

export function ForkSnoozeAgentRowMenu({
  row,
  worktreeId,
  enabled,
  children
}: {
  row: DashboardAgentRow
  worktreeId: string
  enabled: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const t = useTranslate()
  const settings = useForkSnoozeSettings()
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null)
  if (!enabled || !settings.enabled || row.rowSource === 'subagent') {
    return <>{children}</>
  }
  const target = (): ForkSnoozeTarget => {
    const worktree = findWorktreeById(useAppStore.getState(), worktreeId)
    return {
      kind: 'chat',
      paneKey: row.paneKey,
      worktreeId,
      hostId: forkSnoozeHostId(worktree?.hostId)
    }
  }
  return (
    <div
      className="relative"
      {...{ [WORKTREE_CONTEXT_MENU_SCOPE_ATTR]: 'fork-snooze-agent-row' }}
      onContextMenuCapture={(event) => {
        event.preventDefault()
        window.dispatchEvent(new Event(CLOSE_ALL_CONTEXT_MENUS_EVENT))
        const bounds = event.currentTarget.getBoundingClientRect()
        setPoint({ x: event.clientX - bounds.left, y: event.clientY - bounds.top })
      }}
    >
      {children}
      {point ? (
        <DropdownMenu open onOpenChange={(open) => !open && setPoint(null)} modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              aria-hidden
              tabIndex={-1}
              className="pointer-events-none absolute size-px opacity-0"
              style={{ left: point.x, top: point.y }}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-56" sideOffset={0} align="start">
            <DropdownMenuLabel>{t('fork.snooze.menu.snoozeChat', 'Snooze...')}</DropdownMenuLabel>
            <ForkSnoozeChoices target={target()} label={forkAgentRowLabel(row)} />
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )
}
