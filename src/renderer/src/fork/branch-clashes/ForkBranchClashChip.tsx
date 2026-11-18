// Branch clashes (FORK.md, SLRM-2394): a small warning chip on a workspace row whose branch changes
// files another unmerged branch changes too, or that is far behind the default branch. Same chip
// shape as the account chip; the hover lists the shared files and the other branches.
import React from 'react'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { useTranslate } from '@/i18n/use-translate'
import type { ForkClashRowMark } from '../../../../shared/fork/branch-clashes'
import { useForkBranchClash } from './use-fork-branch-clash'

const WARNING_COLOUR = 'var(--git-decoration-modified)'
const MAX_LISTED_FILES = 8

function ClashHover({ mark }: { mark: ForkClashRowMark }): React.JSX.Element {
  const t = useTranslate()
  const listed = mark.files.slice(0, MAX_LISTED_FILES)
  return (
    <div className="space-y-2" data-testid="fork-clash-hover">
      {mark.files.length > 0 ? (
        <div className="text-muted-foreground">
          {t(
            'fork.branchClashes.chip.filesHelp',
            'Other unmerged branches change these files too. A merge may conflict.'
          )}
        </div>
      ) : null}
      {listed.map((entry) => (
        <div key={entry.file} className="space-y-0.5">
          <div className="truncate font-medium">{entry.file}</div>
          <div className="truncate text-muted-foreground">{entry.others.join(', ')}</div>
        </div>
      ))}
      {mark.files.length > listed.length ? (
        <div className="text-muted-foreground">
          {t('fork.branchClashes.chip.more', 'And {{count}} more. Run orca clashes for all.', {
            count: mark.files.length - listed.length
          })}
        </div>
      ) : null}
      {mark.stale && mark.behind !== null ? (
        <div className="text-muted-foreground">
          {t(
            'fork.branchClashes.chip.behindHelp',
            '{{count}} commits behind the default branch. Merge or rebase it before it drifts further.',
            { count: mark.behind }
          )}
        </div>
      ) : null}
    </div>
  )
}

export function ForkBranchClashMark({
  mark
}: {
  mark: ForkClashRowMark
}): React.JSX.Element | null {
  const t = useTranslate()
  if (mark.files.length === 0 && !mark.stale) {
    return null
  }
  const label =
    mark.files.length > 0
      ? t('fork.branchClashes.chip.shared', '{{count}} shared', { count: mark.files.length })
      : t('fork.branchClashes.chip.behind', '{{count}} behind', { count: mark.behind ?? 0 })
  return (
    <HoverCard openDelay={300} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          data-testid="fork-clash-chip"
          aria-label={t('fork.branchClashes.chip.ariaLabel', 'Branch clash: {{value0}}', {
            value0: label
          })}
          tabIndex={-1}
          className="inline-flex max-w-[9rem] shrink-0 cursor-default items-center gap-1 rounded px-1 text-[10px] leading-4 text-muted-foreground hover:bg-accent/60"
        >
          <span
            className="size-1.5 shrink-0 rounded-full ring-1 ring-background"
            style={{ backgroundColor: WARNING_COLOUR }}
          />
          <span className="truncate">{label}</span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent variant="workspace-details" align="start">
        <ClashHover mark={mark} />
      </HoverCardContent>
    </HoverCard>
  )
}

/** The workspace row hook: nothing unless this row's branch clashes or is stale. */
export function ForkBranchClashWorktreeChip({
  worktreeId
}: {
  worktreeId: string
}): React.JSX.Element | null {
  const mark = useForkBranchClash(worktreeId)
  return mark ? <ForkBranchClashMark mark={mark} /> : null
}
