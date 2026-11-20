// BAD-669 (FORK.md "Hide and close bot chats"): "Hide finished chats" on a bot row's menu.
import React, { useMemo } from 'react'
import { EyeOff } from 'lucide-react'
import { ContextMenuItem } from '@/components/ui/context-menu'
import { useBotChatTree } from '@/components/bots/use-bot-chat-tree'
import { useAppStore } from '@/store'
import { useTranslate } from '@/i18n/use-translate'
import type { Bot } from '../../../../shared/bot-types'
import { forkBotChatHiddenIds, forkBotFinishedChatIds } from '../../../../shared/fork/bot-chat-hide'
import { hideBotChats } from './bot-chat-hide-actions'

export function ForkBotHideFinishedMenuItem({ bot }: { bot: Bot }): React.JSX.Element {
  const t = useTranslate()
  const { chats } = useBotChatTree(bot)
  const stored = useAppStore((s) => s.settings?.forkBotHiddenChats)
  const ids = useMemo(
    () => forkBotFinishedChatIds(chats, forkBotChatHiddenIds(chats, stored).hidden),
    [chats, stored]
  )
  return (
    <ContextMenuItem disabled={ids.length === 0} onSelect={() => hideBotChats(ids)}>
      <EyeOff className="size-3.5" />
      {ids.length > 0
        ? t('fork.botChatHide.hideFinishedCount', 'Hide finished chats ({{count}})', {
            count: ids.length
          })
        : t('fork.botChatHide.hideFinished', 'Hide finished chats')}
    </ContextMenuItem>
  )
}
