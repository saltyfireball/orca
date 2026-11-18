// Archive on merge (FORK.md, SLRM-2397): the collapsed "Archived (N)" row at the bottom of the
// sidebar, so an archived workspace can come back: Restore checks its branch out again. Shown
// while any workspace is archived; built from the Snoozed row's styles, nothing new.
import React, { useId, useMemo, useState } from 'react'
import { Archive, ChevronRight } from 'lucide-react'
import { useAppStore } from '@/store'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/class-names'
import { selectWorktreesByRepo } from '@/store/workspaces/catalog/workspace-record-fields'
import type { Worktree } from '../../../../shared/worktree/types'
import { restoreForkArchivedWorktree } from './fork-archived-restore'

function useArchived(): Worktree[] {
  const worktreesByRepo = useAppStore(selectWorktreesByRepo)
  return useMemo(
    () =>
      Object.values(worktreesByRepo ?? {})
        .flatMap((list) => list ?? [])
        .filter((worktree) => worktree.isArchived),
    [worktreesByRepo]
  )
}

function ArchivedRow({ worktree }: { worktree: Worktree }): React.JSX.Element {
  const t = useTranslate()
  const [pending, setPending] = useState(false)
  const name = worktree.displayName || worktree.branch
  return (
    <li
      data-testid="fork-archived-item"
      className="group/hidden-project flex h-7 min-w-0 items-center gap-1.5 rounded-md pl-1.5 pr-0.5 transition-colors hover:bg-worktree-sidebar-accent focus-within:bg-worktree-sidebar-accent"
    >
      <Archive className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-[13px] leading-4">{name}</span>
      <span className="flex shrink-0 can-hover:opacity-0 can-hover:group-hover/hidden-project:opacity-100 focus-within:opacity-100">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={pending}
          aria-label={t('fork.archiveOnMerge.restoreAria', 'Restore {{name}}', { name })}
          onClick={() => {
            setPending(true)
            void restoreForkArchivedWorktree(worktree).finally(() => setPending(false))
          }}
        >
          {t('fork.archiveOnMerge.restore', 'Restore')}
        </Button>
      </span>
    </li>
  )
}

export function ForkArchivedSection(): React.JSX.Element | null {
  const t = useTranslate()
  const listId = useId()
  const archived = useArchived()
  const [expanded, setExpanded] = useState(false)
  if (archived.length === 0) {
    return null
  }
  return (
    <section
      data-testid="fork-archived"
      className="max-h-[40%] shrink-0 overflow-y-auto border-t border-worktree-sidebar-border px-2 py-1 scrollbar-sleek"
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded((value) => !value)}
        className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-[11px] leading-none text-muted-foreground transition-colors hover:bg-worktree-sidebar-accent hover:text-worktree-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-worktree-sidebar-ring"
      >
        <ChevronRight
          className={cn('size-3 shrink-0 transition-transform', expanded && 'rotate-90')}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate">
          {t('fork.archiveOnMerge.section', 'Archived ({{count}})', { count: archived.length })}
        </span>
      </button>
      <ul
        id={listId}
        hidden={!expanded}
        className="flex flex-col pb-1"
        aria-label={t('fork.archiveOnMerge.sectionLabel', 'Archived')}
      >
        {expanded
          ? archived.map((w) => <ArchivedRow key={`${w.hostId ?? ''}:${w.id}`} worktree={w} />)
          : null}
      </ul>
    </section>
  )
}
