// Snooze (FORK.md, SLRM-2269): the collapsed "Snoozed (N)" row at the bottom of the sidebar.
// Opened, it lists each snoozed workspace and chat with when it comes back; a row opens it, and
// Wake ends its snooze. Built from the Hidden projects section's row styles, nothing new.
import React, { useId, useMemo, useState } from 'react'
import { ChevronRight, Moon } from 'lucide-react'
import { useAppStore } from '@/store'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '@/components/ui/button'
import { RepoIconGlyph } from '@/components/repo/repo-icon'
import { cn } from '@/lib/class-names'
import { selectWorktreesByRepo } from '@/store/workspaces/catalog/workspace-record-fields'
import { forkSnoozeWorkspaceKey, type ForkSnoozeEntry } from '../../../../shared/fork/snooze'
import type { Repo } from '../../../../shared/repository/repo-types'
import { wakeForkSnooze } from './snooze-client'
import { openForkSnoozedEntry } from './snooze-open'
import { useForkSnoozeEntries, useForkSnoozeSettings } from './use-fork-snooze'
import { useForkSnoozeLabel } from './snooze-labels'

type Row = { entry: ForkSnoozeEntry; name: string; repo: Repo | null }

function useRows(entries: readonly ForkSnoozeEntry[], expanded: boolean): Row[] {
  const worktreesByRepo = useAppStore((s) => (expanded ? selectWorktreesByRepo(s) : null))
  const repos = useAppStore((s) => s.repos)
  return useMemo(() => {
    const byKey = new Map<string, { displayName: string; repoId: string }>()
    for (const list of Object.values(worktreesByRepo ?? {})) {
      for (const worktree of list ?? []) {
        byKey.set(forkSnoozeWorkspaceKey(worktree.id, worktree.hostId), worktree)
      }
    }
    return entries.map((entry) => {
      const worktree =
        entry.target.kind === 'workspace'
          ? byKey.get(forkSnoozeWorkspaceKey(entry.target.worktreeId, entry.target.hostId))
          : undefined
      return {
        entry,
        name: worktree?.displayName || entry.label,
        repo: worktree ? (repos.find((repo) => repo.id === worktree.repoId) ?? null) : null
      }
    })
  }, [entries, worktreesByRepo, repos])
}

function SnoozedRow({ row, wakeOnOpen }: { row: Row; wakeOnOpen: boolean }): React.JSX.Element {
  const t = useTranslate()
  const wakeLabel = useForkSnoozeLabel(row.entry.until)
  const [pending, setPending] = useState(false)
  return (
    <li
      data-testid="fork-snoozed-item"
      className="group/hidden-project flex h-7 min-w-0 items-center gap-1.5 rounded-md pl-1.5 pr-0.5 transition-colors hover:bg-worktree-sidebar-accent focus-within:bg-worktree-sidebar-accent"
    >
      {row.repo ? (
        <RepoIconGlyph
          repoIcon={row.repo.repoIcon}
          color={row.repo.badgeColor || undefined}
          className="size-4 shrink-0 text-muted-foreground"
          iconClassName="size-3.5"
        />
      ) : (
        <Moon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <button
        type="button"
        onClick={() => openForkSnoozedEntry(row.entry, wakeOnOpen)}
        className="min-w-0 flex-1 truncate text-left text-[13px] leading-4 focus-visible:outline-none"
      >
        {row.name}
      </button>
      <span className="min-w-0 max-w-[40%] shrink truncate text-[10px] leading-none text-muted-foreground">
        {wakeLabel}
      </span>
      <span className="flex shrink-0 can-hover:opacity-0 can-hover:group-hover/hidden-project:opacity-100 focus-within:opacity-100">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={pending}
          aria-label={t('fork.snooze.section.wakeAriaLabel', 'Wake {{name}}', { name: row.name })}
          onClick={() => {
            setPending(true)
            void wakeForkSnooze(row.entry.id, 'manual').finally(() => setPending(false))
          }}
          className="shrink-0"
        >
          {t('fork.snooze.section.wake', 'Wake')}
        </Button>
      </span>
    </li>
  )
}

/** Hidden while snooze is off or nothing is snoozed. */
export function ForkSnoozedSection(): React.JSX.Element | null {
  const t = useTranslate()
  const listId = useId()
  const settings = useForkSnoozeSettings()
  const entries = useForkSnoozeEntries()
  const [expanded, setExpanded] = useState(false)
  const rows = useRows(entries, expanded)
  if (!settings.enabled || entries.length === 0) {
    return null
  }
  return (
    <section
      data-testid="fork-snoozed"
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
          {t('fork.snooze.section.title', 'Snoozed ({{count}})', { count: entries.length })}
        </span>
      </button>
      <ul
        id={listId}
        hidden={!expanded}
        className="flex flex-col pb-1"
        aria-label={t('fork.snooze.section.listLabel', 'Snoozed')}
      >
        {expanded
          ? rows.map((row) => (
              <SnoozedRow key={row.entry.id} row={row} wakeOnOpen={settings.wakeOnOpen} />
            ))
          : null}
      </ul>
    </section>
  )
}
