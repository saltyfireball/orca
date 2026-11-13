// SLRM-1503: the account picker the command palette's move actions open. Mounted once at the app
// root (FORK.md); openForkMoveAccountDialog shows it for a chat or a worktree.
import React, { useSyncExternalStore } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { ForkClaudeMoveScope } from './claude-account-move-client'
import { runForkClaudeMove } from './fork-claude-move-actions'
import { usageText, useForkClaudeMoveAccounts } from './use-fork-claude-move-accounts'

type DialogRequest = { target: RuntimeClientTarget | null; scope: ForkClaudeMoveScope }

let request: DialogRequest | null = null
const listeners = new Set<() => void>()

function setRequest(next: DialogRequest | null): void {
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

export function openForkMoveAccountDialog(next: DialogRequest): void {
  setRequest(next)
}

function DialogBody({ target, scope }: DialogRequest): React.JSX.Element {
  const t = useTranslate()
  const { choices, currentAccountId, failed } = useForkClaudeMoveAccounts(target, true, scope)
  const message = (text: string) => <p className="text-sm text-muted-foreground">{text}</p>
  if (!target) {
    return message(t('fork.accountMove.noHost', 'This host cannot move Claude chats.'))
  }
  if (failed) {
    return message(t('fork.accountMove.readFailed', "Could not read this host's accounts."))
  }
  if (!choices) {
    return message(t('fork.accountMove.loading', 'Loading accounts...'))
  }
  const others = choices.filter((choice) => choice.id !== currentAccountId)
  if (others.length === 0) {
    return message(t('fork.accountMove.noOthers', 'No other Claude accounts on this host.'))
  }
  return (
    <div className="flex flex-col gap-1">
      {others.map((choice) => (
        <Button
          key={choice.id ?? 'system'}
          variant="ghost"
          className="justify-between"
          onClick={() => {
            setRequest(null)
            void runForkClaudeMove(target, scope, choice)
          }}
        >
          <span className="min-w-0 truncate">{choice.label}</span>
          <span className="text-xs text-muted-foreground">{usageText(choice, t)}</span>
        </Button>
      ))}
    </div>
  )
}

export function ForkMoveAccountDialogHost(): React.JSX.Element | null {
  const t = useTranslate()
  const current = useSyncExternalStore(subscribe, () => request)
  if (!current) {
    return null
  }
  const chat = 'sessionId' in current.scope
  return (
    <Dialog open onOpenChange={(open) => !open && setRequest(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {chat
              ? t('fork.accountMove.chatTitle', 'Move this chat to account')
              : t('fork.accountMove.worktreeTitle', "Move this worktree's chats to account")}
          </DialogTitle>
          <DialogDescription>
            {t(
              'fork.accountMove.dialogHint',
              'Only these chats move. A chat mid-turn moves when its turn ends.'
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody target={current.target} scope={current.scope} />
      </DialogContent>
    </Dialog>
  )
}
