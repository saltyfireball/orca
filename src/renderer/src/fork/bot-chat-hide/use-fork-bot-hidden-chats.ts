// BAD-669 (FORK.md "Hide and close bot chats"): the chats a bot's sidebar section leaves out, and
// the clean-up of a hide once the chat needs the owner again.
import { useEffect, useMemo } from 'react'
import { useAppStore } from '@/store'
import type { BotChatTreeChat } from '../../../../shared/bots/bot-chat-tree'
import { forkBotChatHiddenIds } from '../../../../shared/fork/bot-chat-hide'
import { unhideBotChats } from './bot-chat-hide-actions'

export function useForkBotHiddenChats(chats: readonly BotChatTreeChat[]): ReadonlySet<string> {
  const stored = useAppStore((s) => s.settings?.forkBotHiddenChats)
  const view = useMemo(() => forkBotChatHiddenIds(chats, stored), [chats, stored])
  // A chat that came back stays listed once it is answered: the hide is spent.
  const key = view.reappeared.join('\n')
  useEffect(() => {
    if (key !== '') {
      unhideBotChats(key.split('\n'))
    }
  }, [key])
  return view.hidden
}
