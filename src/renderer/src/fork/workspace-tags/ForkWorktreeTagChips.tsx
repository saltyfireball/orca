// Workspace tags (FORK.md, SLRM-2397): a workspace card's tags after its title, as stock
// reference-label badges. A click filters the sidebar to that tag, again hides it, again clears.
import React from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import { forkWorkspaceTagKey } from '../../../../shared/fork/workspace-tags'
import { cycleForkTagFilter, useForkWorkspaceTagSettings } from './use-fork-workspace-tags'

/** Two tags show whole; the rest count as +N, all of them named on hover. */
const SHOWN = 2

export function ForkWorktreeTagChips({
  worktreeId,
  hostId
}: {
  worktreeId: string
  hostId?: string | null
}): React.JSX.Element | null {
  const t = useTranslate()
  const settings = useForkWorkspaceTagSettings()
  const tags = settings.tags[forkWorkspaceTagKey(worktreeId, hostId)] ?? []
  if (!settings.enabled || tags.length === 0) {
    return null
  }
  const stop = (event: React.SyntheticEvent): void => event.stopPropagation()
  const more = tags.length - SHOWN
  return (
    <span className="ml-1 inline-flex min-w-0 shrink items-center gap-0.5" data-fork-tags="">
      {tags.slice(0, SHOWN).map((tag) => {
        const active = settings.filter?.tag === tag
        return (
          <Badge
            key={tag}
            asChild
            variant="referenceLabel"
            className={cn(
              'max-w-[6rem] cursor-pointer hover:bg-accent/60',
              active && 'ring-1 ring-ring'
            )}
          >
            <button
              type="button"
              title={t('fork.workspaceTags.chipTitle', 'Filter the sidebar by {{tag}}', { tag })}
              onPointerDown={stop}
              onMouseDown={stop}
              onClick={(event) => {
                stop(event)
                cycleForkTagFilter(tag)
              }}
            >
              <span className="truncate">{tag}</span>
            </button>
          </Badge>
        )
      })}
      {more > 0 ? (
        <Badge variant="referenceLabel" title={tags.slice(SHOWN).join(', ')}>
          +{more}
        </Badge>
      ) : null}
    </span>
  )
}
