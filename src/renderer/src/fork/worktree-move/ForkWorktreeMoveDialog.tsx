// SLRM-2265 (FORK.md "Worktree move"): the confirm dialog behind the workspace menu's "Move to
// host". It shows the dry run (steps, chats, notes), asks before stopping a running turn, then
// runs the move. Mounted once at the app root through ForkRootHosts.
import React, { useEffect, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { translate } from '@/i18n/i18n'
import { stripWorktreeMoveControlChars as clean } from '../../../../shared/fork/worktree-move/worktree-move-ref'
import {
  WORKTREE_MOVE_TRANSCRIPTS_NOTICE,
  WORKTREE_MOVE_UNTRACKED_NOTICE,
  worktreeMoveUntrackedNames
} from '../../../../shared/fork/worktree-move/worktree-move-notice'
import type { WorktreeMoveRunResult } from '../../../../shared/fork/worktree-move/worktree-move-runner'
import { runDesktopWorktreeMove, type WorktreeMoveRequest } from './worktree-move-client'

let request: WorktreeMoveRequest | null = null
const listeners = new Set<() => void>()

function setRequest(next: WorktreeMoveRequest | null): void {
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

export function openForkWorktreeMoveDialog(next: WorktreeMoveRequest): void {
  setRequest(next)
}

type Preview =
  | { kind: 'loading' }
  | { kind: 'failed'; message: string }
  | { kind: 'ready'; result: WorktreeMoveRunResult }

function errorText(error: unknown): string {
  return clean(error instanceof Error ? error.message : String(error))
}

function previewLines(result: WorktreeMoveRunResult): string[] {
  if (result.kind === 'refuse' || result.kind === 'ask') {
    return [clean(result.plan.message)]
  }
  if (result.kind !== 'dry-run') {
    return []
  }
  const { plan } = result
  const { names, more } = worktreeMoveUntrackedNames(result.source)
  return [
    translate('fork.worktreeMove.copiesTranscripts', WORKTREE_MOVE_TRANSCRIPTS_NOTICE),
    ...(plan.carryPatch
      ? [
          translate('fork.worktreeMove.copiesUntracked', WORKTREE_MOVE_UNTRACKED_NOTICE),
          ...names.map(
            (name) => `${translate('fork.worktreeMove.untrackedFile', 'Untracked')}: ${name}`
          ),
          ...(more > 0
            ? [
                translate(
                  'fork.worktreeMove.untrackedMore',
                  '...and {{count}} more untracked file(s)',
                  { count: more }
                )
              ]
            : [])
        ]
      : []),
    ...plan.chats.map((chat) => clean(`Carries chat: ${chat.name} (${chat.agent})`)),
    ...plan.skippedChats.map(({ chat, reason }) => clean(`Stays behind: ${chat.name} (${reason})`)),
    ...plan.warnings.map(clean)
  ]
}

async function runMove(current: WorktreeMoveRequest, stopTurns: boolean): Promise<void> {
  setRequest(null)
  const pending = toast.loading(
    translate('fork.worktreeMove.moving', 'Moving the workspace to {{host}}...', {
      host: current.targetLabel
    })
  )
  try {
    const result = await runDesktopWorktreeMove(current, { stopTurns, dryRun: false })
    if (result.kind !== 'moved') {
      toast.error(
        result.kind === 'dry-run'
          ? translate('fork.worktreeMove.notRun', 'The move did not run.')
          : clean(result.plan.message),
        {
          id: pending
        }
      )
      return
    }
    const reopened = result.chats.filter((chat) => chat.targetSessionId).length
    const left = result.chats.length - reopened
    toast.success(
      translate('fork.worktreeMove.moved', 'Moved to {{host}}', { host: current.targetLabel }),
      {
        id: pending,
        description: [
          `${reopened} chat(s) reopened${left > 0 ? `, ${left} left behind` : ''}.`,
          result.patch.kind === 'failed'
            ? `Uncommitted changes did not apply; the patch is saved at ${clean(result.patch.savedTo)}.`
            : '',
          result.marked ? 'The source workspace is marked as moved and was not deleted.' : ''
        ]
          .filter(Boolean)
          .join(' ')
      }
    )
  } catch (error) {
    toast.error(translate('fork.worktreeMove.stopped', 'The workspace move stopped'), {
      id: pending,
      description: errorText(error)
    })
  }
}

function MoveDialogBody({ current }: { current: WorktreeMoveRequest }): React.JSX.Element {
  const t = useTranslate()
  const [preview, setPreview] = useState<Preview>({ kind: 'loading' })
  useEffect(() => {
    let live = true
    runDesktopWorktreeMove(current, { stopTurns: false, dryRun: true }).then(
      (result) => live && setPreview({ kind: 'ready', result }),
      (error: unknown) => live && setPreview({ kind: 'failed', message: errorText(error) })
    )
    return () => {
      live = false
    }
  }, [current])
  const message = (text: string) => <p className="text-sm text-muted-foreground">{text}</p>
  if (preview.kind === 'loading') {
    return message(t('fork.worktreeMove.checking', 'Checking the workspace and the target...'))
  }
  if (preview.kind === 'failed') {
    return message(preview.message)
  }
  const { result } = preview
  const canMove = result.kind === 'dry-run' || result.kind === 'ask'
  return (
    <>
      {result.kind === 'dry-run'
        ? message(
            `Branch ${result.plan.branch} on ${result.plan.remote}. Steps: ${result.plan.steps.join(', ')}.`
          )
        : null}
      <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
        {previewLines(result).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <DialogFooter>
        <Button variant="ghost" onClick={() => setRequest(null)}>
          {t('fork.worktreeMove.cancel', 'Cancel')}
        </Button>
        {canMove ? (
          <Button onClick={() => void runMove(current, result.kind === 'ask')}>
            {result.kind === 'ask'
              ? t('fork.worktreeMove.stopAndMove', 'Stop turns and move')
              : t('fork.worktreeMove.move', 'Move')}
          </Button>
        ) : null}
      </DialogFooter>
    </>
  )
}

export function ForkWorktreeMoveDialogHost(): React.JSX.Element | null {
  const t = useTranslate()
  const current = useSyncExternalStore(subscribe, () => request)
  if (!current) {
    return null
  }
  return (
    <Dialog open onOpenChange={(open) => !open && setRequest(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{`${t('fork.worktreeMove.title', 'Move workspace to')} ${current.targetLabel}`}</DialogTitle>
          <DialogDescription>
            {t(
              'fork.worktreeMove.hint',
              'Nothing is committed: uncommitted changes travel as a patch. The source workspace is kept and marked as moved.'
            )}
          </DialogDescription>
        </DialogHeader>
        <MoveDialogBody current={current} />
      </DialogContent>
    </Dialog>
  )
}
