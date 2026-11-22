// The Chats tab's toggle for closed chats (FORK.md "Auto-close finished bot chats", BAD-734).
import React from 'react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import type { ForkClosedBotChats } from './use-fork-closed-bot-chats'

export function ForkClosedBotChatsToggle({
  closed
}: {
  closed: ForkClosedBotChats
}): React.JSX.Element | null {
  const t = useTranslate()
  if (closed.total === 0 && !closed.shown) {
    return null
  }
  return (
    <div className="flex items-center gap-2 px-2 py-1 text-xs">
      <Button variant="link" size="inlineText" onClick={closed.toggle}>
        {closed.shown
          ? t('fork.botChatClosed.hide', 'Hide closed chats')
          : t('fork.botChatClosed.show', 'Show older chats ({{count}} closed)', {
              count: closed.total
            })}
      </Button>
      {closed.more ? (
        <Button
          variant="link"
          size="inlineText"
          disabled={closed.loading}
          onClick={closed.loadMore}
        >
          {t('fork.botChatClosed.more', 'Show more')}
        </Button>
      ) : null}
    </div>
  )
}
