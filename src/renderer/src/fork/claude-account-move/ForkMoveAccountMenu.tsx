// SLRM-1503: "Move to account" menus. ForkMoveAccountMenu is a dropdown around any trigger (the
// account chip plugs in through its `menu` prop); ForkMoveAccountContextSubmenu sits in a
// right-click menu. Both list the other Claude accounts of the host that runs the chats.
import React, { useState } from 'react'
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import type { ForkClaudeMoveResponse } from '../../../../shared/fork/claude-account-move'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { ForkClaudeMoveScope } from './claude-account-move-client'
import { forkClaudeChatTarget, runForkClaudeMove } from './fork-claude-move-actions'
import { usageText, useForkClaudeMoveAccounts } from './use-fork-claude-move-accounts'

export type ForkMoveAccountMenuProps = {
  /** The runtime that runs the chats; null for a host that cannot move them. */
  target: RuntimeClientTarget | null
  scope: ForkClaudeMoveScope
  /** Called with the host's per-chat results after a move request returns. */
  onMoved?: (response: ForkClaudeMoveResponse) => void
}

type ItemComponent = typeof ContextMenuItem | typeof DropdownMenuItem

function AccountItems({
  Item,
  open,
  target,
  scope,
  onMoved
}: ForkMoveAccountMenuProps & { Item: ItemComponent; open: boolean }): React.JSX.Element {
  const t = useTranslate()
  const { choices, currentAccountId, failed } = useForkClaudeMoveAccounts(target, open, scope)
  const note = (text: string) => <Item disabled>{text}</Item>
  if (!target) {
    return note(t('fork.accountMove.noHost', 'This host cannot move Claude chats.'))
  }
  if (failed) {
    return note(t('fork.accountMove.readFailed', "Could not read this host's accounts."))
  }
  if (!choices) {
    return note(t('fork.accountMove.loading', 'Loading accounts...'))
  }
  // A single chat lists only the accounts it is not already on.
  const others = choices.filter((choice) => choice.id !== currentAccountId)
  if (others.length === 0) {
    return note(t('fork.accountMove.noOthers', 'No other Claude accounts on this host.'))
  }
  return (
    <>
      {others.map((choice) => (
        <Item
          key={choice.id ?? 'system'}
          onSelect={() => {
            void runForkClaudeMove(target, scope, choice).then(
              (response) => response && onMoved?.(response)
            )
          }}
        >
          <span className="min-w-0 truncate">{choice.label}</span>
          <span className="ml-auto pl-4 text-xs text-muted-foreground">{usageText(choice, t)}</span>
        </Item>
      ))}
    </>
  )
}

function menuTitle(scope: ForkClaudeMoveScope, t: Translate = translate): string {
  return 'sessionId' in scope
    ? t('fork.accountMove.chatTitle', 'Move this chat to account')
    : t('fork.accountMove.worktreeTitle', "Move this worktree's chats to account")
}

/** A dropdown around `trigger` (rendered as the DropdownMenuTrigger's asChild child). */
export function ForkMoveAccountMenu({
  trigger,
  align = 'start',
  ...props
}: ForkMoveAccountMenuProps & {
  trigger: React.ReactElement
  align?: 'start' | 'center' | 'end'
}): React.JSX.Element {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-[16rem]">
        <DropdownMenuLabel>{menuTitle(props.scope, t)}</DropdownMenuLabel>
        <AccountItems {...props} Item={DropdownMenuItem} open={open} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A "Move to account" submenu for a right-click menu. */
export function ForkMoveAccountContextSubmenu(props: ForkMoveAccountMenuProps): React.JSX.Element {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  return (
    <ContextMenuSub open={open} onOpenChange={setOpen}>
      <ContextMenuSubTrigger>
        {'sessionId' in props.scope
          ? t('fork.accountMove.chatSubmenu', 'Move chat to account')
          : t('fork.accountMove.worktreeSubmenu', 'Move chats to account')}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="min-w-[16rem]">
        <AccountItems {...props} Item={ContextMenuItem} open={open} />
      </ContextMenuSubContent>
    </ContextMenuSub>
  )
}

/** Stock hook in a native chat tab's right-click menu (FORK.md). */
export function ForkMoveAccountTabMenuItems({
  worktreeId,
  sessionId
}: {
  worktreeId: string
  sessionId: string
}): React.JSX.Element {
  // Read once per menu open, like the tab's other session items: a target object is rebuilt per read.
  const [target] = useState(() =>
    forkClaudeChatTarget(useAppStore.getState(), worktreeId, sessionId)
  )
  return (
    <>
      <ContextMenuSeparator />
      <ForkMoveAccountContextSubmenu target={target} scope={{ sessionId }} />
    </>
  )
}
