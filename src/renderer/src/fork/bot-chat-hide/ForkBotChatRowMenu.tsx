// BAD-669 (FORK.md "Hide and close bot chats"): the right-click menu and the hover x on a bot's
// chat row in the sidebar. Hide keeps the chat going and reachable from the bot's Chats tab; Close
// ends it, after a confirm when it is running. Never offered on the Home Chat.
import React, { useState } from 'react'
import { EyeOff, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
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
import type { Bot } from '../../../../shared/bot-types'
import type { BotChatTreeChat } from '../../../../shared/bots/bot-chat-tree'
import { forkBotChatCanDismiss } from '../../../../shared/fork/bot-chat-hide'
import { botChatNeedsCloseConfirm, closeBotChat, hideBotChats } from './bot-chat-hide-actions'

function useCloseChat(bot: Bot, chat: BotChatTreeChat) {
  const t = useTranslate()
  const [asking, setAsking] = useState(false)
  const close = (): void => {
    setAsking(false)
    void closeBotChat(bot, chat)
      .then((result) => {
        if (!result.closed) {
          toast.error(
            t('fork.botChatHide.closeFailed', 'Could not close this chat.') +
              (result.reason === 'failed' && result.detail ? ` ${result.detail}` : '')
          )
        }
      })
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : String(error))
      )
  }
  const request = (): void => (botChatNeedsCloseConfirm(chat) ? setAsking(true) : close())
  return { asking, setAsking, close, request }
}

export function ForkBotChatRowMenu({
  bot,
  chat,
  children
}: {
  bot: Bot
  chat: BotChatTreeChat
  children: React.ReactNode
}): React.JSX.Element {
  const t = useTranslate()
  const closing = useCloseChat(bot, chat)
  if (!forkBotChatCanDismiss(chat)) {
    return <>{children}</>
  }
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => hideBotChats([chat.chatId])}>
            <EyeOff className="size-3.5" />
            {t('fork.botChatHide.hide', 'Hide from sidebar')}
          </ContextMenuItem>
          <ContextMenuItem onSelect={closing.request}>
            <X className="size-3.5" />
            {t('fork.botChatHide.close', 'Close chat')}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <Dialog open={closing.asking} onOpenChange={closing.setAsking}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('fork.botChatHide.confirmTitle', 'Close this chat?')}</DialogTitle>
            <DialogDescription>
              {t(
                'fork.botChatHide.confirmBody',
                '“{{title}}” is still running or waiting on you. Closing it stops it. Its history stays in the bot’s Chats tab.',
                { title: chat.title }
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => closing.setAsking(false)}>
              {t('fork.botChatHide.cancel', 'Cancel')}
            </Button>
            <Button variant="destructive" onClick={closing.close}>
              {t('fork.botChatHide.close', 'Close chat')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** The x shown on hover: hides the chat from the sidebar without stopping it. */
export function ForkBotChatHideButton({
  chat
}: {
  chat: BotChatTreeChat
}): React.JSX.Element | null {
  const t = useTranslate()
  if (!forkBotChatCanDismiss(chat)) {
    return null
  }
  const label = t('fork.botChatHide.hide', 'Hide from sidebar')
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-fork-bot-chat-hide=""
      className="hidden size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-foreground group-hover/bot-chat:inline-flex"
      onClick={(event) => {
        event.stopPropagation()
        hideBotChats([chat.chatId])
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <X className="size-3" />
    </button>
  )
}
