// Workspace tags (FORK.md, SLRM-2397): the workspace menu's "Tags..." item and the small dialog
// it opens, words split by spaces or commas. The dialog is mounted once through ForkRootHosts.
import React, { useState, useSyncExternalStore } from 'react'
import { Tag } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTranslate } from '@/i18n/use-translate'
import {
  forkWorkspaceTagKey,
  MAX_TAGS_PER_WORKSPACE,
  parseTags,
  tagCounts
} from '../../../../shared/fork/workspace-tags'
import {
  readForkWorkspaceTagsNow,
  saveForkWorkspaceTags,
  useForkWorkspaceTagSettings
} from './use-fork-workspace-tags'

type Target = { id: string; hostId?: string | null; displayName: string }

let request: Target | null = null
const listeners = new Set<() => void>()

function setRequest(next: Target | null): void {
  request = next
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function ForkTagsWorktreeMenuItem({
  worktree,
  disabled
}: {
  worktree: Target
  disabled?: boolean
}): React.JSX.Element | null {
  const t = useTranslate()
  const { enabled } = useForkWorkspaceTagSettings()
  if (!enabled) {
    return null
  }
  return (
    <DropdownMenuItem disabled={disabled} onSelect={() => setRequest(worktree)}>
      <Tag className="size-3.5" />
      {t('fork.workspaceTags.menu', 'Tags...')}
    </DropdownMenuItem>
  )
}

function TagsForm({ target }: { target: Target }): React.JSX.Element {
  const t = useTranslate()
  const [value, setValue] = useState(() => {
    const { tags } = readForkWorkspaceTagsNow()
    return (tags[forkWorkspaceTagKey(target.id, target.hostId)] ?? []).join(' ')
  })
  const { tags: all } = useForkWorkspaceTagSettings()
  const parsed = parseTags(value)
  const known = tagCounts(all)
    .map(({ tag }) => tag)
    .filter((tag) => !parsed.includes(tag))
    .slice(0, 12)
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        saveForkWorkspaceTags(target, parsed)
        setRequest(null)
      }}
    >
      <Input
        autoFocus
        value={value}
        placeholder={t('fork.workspaceTags.placeholder', 'review, client-a, blocked')}
        aria-label={t('fork.workspaceTags.inputLabel', 'Tags')}
        onChange={(event) => setValue(event.target.value)}
      />
      {known.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {known.map((tag) => (
            <Button
              key={tag}
              type="button"
              variant="outline"
              size="xs"
              disabled={parsed.length >= MAX_TAGS_PER_WORKSPACE}
              onClick={() => setValue((current) => `${current.trim()} ${tag}`.trim())}
            >
              {tag}
            </Button>
          ))}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {t(
          'fork.workspaceTags.help',
          'Up to 8 short words: letters, digits, dash, dot, colon or slash. Empty removes every tag.'
        )}
      </p>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={() => setRequest(null)}>
          {t('fork.workspaceTags.cancel', 'Cancel')}
        </Button>
        <Button type="submit">{t('fork.workspaceTags.save', 'Save')}</Button>
      </DialogFooter>
    </form>
  )
}

export function ForkWorkspaceTagsDialogHost(): React.JSX.Element | null {
  const t = useTranslate()
  const current = useSyncExternalStore(subscribe, () => request)
  if (!current) {
    return null
  }
  return (
    <Dialog open onOpenChange={(open) => !open && setRequest(null)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('fork.workspaceTags.title', 'Tags')}</DialogTitle>
          <DialogDescription>
            {t(
              'fork.workspaceTags.description',
              'Tags for {{name}}. Click a tag in the sidebar to show only its workspaces.',
              { name: current.displayName }
            )}
          </DialogDescription>
        </DialogHeader>
        <TagsForm target={current} />
      </DialogContent>
    </Dialog>
  )
}
