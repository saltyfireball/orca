// Sleepers (FORK.md): the dialog's filter and sort controls.
import React from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import {
  SLEEPER_STATES,
  type SleeperRow,
  type SleeperSortKey,
  type SleeperState
} from '../../../../shared/fork/sleepers'
import { sleeperStateLabel } from './ForkSleepersRow'
import { sleeperWorkspaces } from './sleepers-view-model'

export type SleepersView = {
  state: SleeperState | 'all'
  /** Empty is every workspace. */
  worktreeId: string
  minIdleMs: number
  sort: SleeperSortKey
  descending: boolean
}

/** The idle filter's choices, in minutes; 0 is any. */
const IDLE_MINUTES = [0, 15, 60, 240, 1440]

function idleLabel(minutes: number, t: Translate = translate): string {
  if (minutes === 0) {
    return t('fork.sleepers.filter.anyIdle', 'Any idle time')
  }
  return minutes < 60
    ? t('fork.sleepers.filter.idleMinutes', 'Idle {{count}}m+', { count: minutes })
    : t('fork.sleepers.filter.idleHours', 'Idle {{count}}h+', { count: minutes / 60 })
}

function sortLabel(key: SleeperSortKey, t: Translate = translate): string {
  switch (key) {
    case 'idle':
      return t('fork.sleepers.sort.idle', 'Sort by idle time')
    case 'activity':
      return t('fork.sleepers.sort.activity', 'Sort by last activity')
    case 'workspace':
      return t('fork.sleepers.sort.workspace', 'Sort by workspace')
    case 'state':
      return t('fork.sleepers.sort.state', 'Sort by state')
  }
}

const SELECT = 'h-8 rounded-md border border-input bg-transparent px-2 text-xs'

export function ForkSleepersFilters({
  rows,
  view,
  onChange
}: {
  rows: readonly SleeperRow[]
  view: SleepersView
  onChange: (next: SleepersView) => void
}): React.JSX.Element {
  const t = useTranslate()
  const set = (patch: Partial<SleepersView>) => onChange({ ...view, ...patch })
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className={SELECT}
        aria-label={t('fork.sleepers.filter.state', 'State')}
        value={view.state}
        onChange={(event) => set({ state: event.target.value as SleepersView['state'] })}
      >
        <option value="all">{t('fork.sleepers.filter.allStates', 'All states')}</option>
        {SLEEPER_STATES.map((state) => (
          <option key={state} value={state}>
            {sleeperStateLabel(state, t)}
          </option>
        ))}
      </select>
      <select
        className={SELECT}
        aria-label={t('fork.sleepers.filter.workspace', 'Workspace')}
        value={view.worktreeId}
        onChange={(event) => set({ worktreeId: event.target.value })}
      >
        <option value="">{t('fork.sleepers.filter.allWorkspaces', 'All workspaces')}</option>
        {sleeperWorkspaces(rows).map((workspace) => (
          <option key={workspace.worktreeId} value={workspace.worktreeId}>
            {workspace.name}
          </option>
        ))}
      </select>
      <select
        className={SELECT}
        aria-label={t('fork.sleepers.filter.idle', 'Idle time')}
        value={view.minIdleMs / 60_000}
        onChange={(event) => set({ minIdleMs: Number(event.target.value) * 60_000 })}
      >
        {IDLE_MINUTES.map((minutes) => (
          <option key={minutes} value={minutes}>
            {idleLabel(minutes, t)}
          </option>
        ))}
      </select>
      <select
        className={SELECT}
        aria-label={t('fork.sleepers.sort.label', 'Sort')}
        value={view.sort}
        onChange={(event) => set({ sort: event.target.value as SleeperSortKey })}
      >
        {(['idle', 'activity', 'workspace', 'state'] as const).map((key) => (
          <option key={key} value={key}>
            {sortLabel(key, t)}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        variant="ghost"
        aria-label={t('fork.sleepers.sort.direction', 'Reverse the order')}
        onClick={() => set({ descending: !view.descending })}
      >
        {view.descending ? <ArrowDown className="size-3.5" /> : <ArrowUp className="size-3.5" />}
      </Button>
    </div>
  )
}
