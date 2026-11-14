// SLRM-2230 (FORK.md "Lost work"): the rows grouped by project. Each project has a header with
// its count and a checkbox for its shown rows, and folds away.
import React from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { useTranslate } from '@/i18n/use-translate'
import type { LostWorkItem } from '../../../../shared/fork/lost-work'
import { lostWorkSelectAllState, type LostWorkGroup } from './lost-work-bulk'
import { ForkLostWorkRow } from './ForkLostWorkRow'
import type { LostWorkRowAction } from './lost-work-row-actions'

export function ForkLostWorkList({
  groups,
  selected,
  collapsed,
  busy,
  onToggleCollapsed,
  onToggleGroup,
  onSelect,
  onAction
}: {
  groups: readonly LostWorkGroup[]
  selected: ReadonlySet<string>
  collapsed: ReadonlySet<string>
  busy: boolean
  onToggleCollapsed: (repoId: string) => void
  onToggleGroup: (items: readonly LostWorkItem[]) => void
  onSelect: (item: LostWorkItem, selected: boolean) => void
  onAction: (item: LostWorkItem, action: LostWorkRowAction) => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <>
      {groups.map((group) => {
        const folded = collapsed.has(group.repoId)
        const Chevron = folded ? ChevronRight : ChevronDown
        return (
          <section key={group.repoId}>
            <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-muted px-4 py-1.5">
              <Checkbox
                checked={lostWorkSelectAllState(group.items, selected)}
                disabled={busy}
                onCheckedChange={() => onToggleGroup(group.items)}
                aria-label={t('fork.lostWork.selectProject', 'Select the rows of {{name}}', {
                  name: group.repoName
                })}
              />
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-medium"
                aria-expanded={!folded}
                onClick={() => onToggleCollapsed(group.repoId)}
              >
                <Chevron className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate">{group.repoName}</span>
                <span className="text-muted-foreground">{group.items.length}</span>
              </button>
            </div>
            {folded
              ? null
              : group.items.map((item) => (
                  <ForkLostWorkRow
                    key={item.id}
                    item={item}
                    selected={selected.has(item.id)}
                    busy={busy}
                    onSelect={onSelect}
                    onAction={onAction}
                  />
                ))}
          </section>
        )
      })}
    </>
  )
}
