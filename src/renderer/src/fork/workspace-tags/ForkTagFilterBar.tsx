// Workspace tags (FORK.md, SLRM-2397): one line over the workspace list while a tag filter is
// on, saying which tag and how, with Clear. Built from the sidebar's notice row styles.
import React from 'react'
import { Tag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import {
  clearForkTagFilter,
  cycleForkTagFilter,
  useForkWorkspaceTagSettings
} from './use-fork-workspace-tags'

export function ForkTagFilterBar(): React.JSX.Element | null {
  const t = useTranslate()
  const { enabled, filter } = useForkWorkspaceTagSettings()
  if (!enabled || !filter) {
    return null
  }
  return (
    <div
      data-fork-tag-filter={filter.mode}
      className="flex h-7 shrink-0 items-center gap-1.5 px-3 text-[11px] leading-none text-muted-foreground"
    >
      <Tag className="size-3 shrink-0" aria-hidden="true" />
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left hover:text-foreground focus-visible:outline-none"
        title={t('fork.workspaceTags.filterSwitch', 'Click to switch between only and hidden')}
        onClick={() => cycleForkTagFilter(filter.tag)}
      >
        {filter.mode === 'only'
          ? t('fork.workspaceTags.filterOnly', 'Only {{tag}}', { tag: filter.tag })
          : t('fork.workspaceTags.filterHide', 'Hiding {{tag}}', { tag: filter.tag })}
      </button>
      <Button type="button" variant="ghost" size="xs" onClick={clearForkTagFilter}>
        {t('fork.workspaceTags.filterClear', 'Clear')}
      </Button>
    </div>
  )
}
