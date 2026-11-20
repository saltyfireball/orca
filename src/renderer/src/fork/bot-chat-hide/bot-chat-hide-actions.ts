// BAD-669 (FORK.md "Hide and close bot chats"): what the sidebar's Hide and Close do.
import { callBotRpc } from '@/lib/bot-hosts'
import { useAppStore } from '@/store'
import type { Bot } from '../../../../shared/bot-types'
import type { BotChatTreeChat } from '../../../../shared/bots/bot-chat-tree'
import {
  forkBotHiddenChatsWith,
  forkBotHiddenChatsWithout,
  type ForkBotChatCloseResult
} from '../../../../shared/fork/bot-chat-hide'

export function hideBotChats(chatIds: readonly string[]): void {
  if (chatIds.length === 0) {
    return
  }
  const stored = useAppStore.getState().settings?.forkBotHiddenChats
  void useAppStore
    .getState()
    .updateSettings({ forkBotHiddenChats: forkBotHiddenChatsWith(stored, chatIds, Date.now()) })
}

export function unhideBotChats(chatIds: readonly string[]): void {
  if (chatIds.length === 0) {
    return
  }
  const stored = useAppStore.getState().settings?.forkBotHiddenChats
  void useAppStore
    .getState()
    .updateSettings({ forkBotHiddenChats: forkBotHiddenChatsWithout(stored, chatIds) })
}

/** A chat that replies, runs workers or waits on the owner asks before it is closed. */
export function botChatNeedsCloseConfirm(chat: BotChatTreeChat): boolean {
  return chat.live !== 'idle' || chat.runningTotal > 0
}

export function closeBotChat(bot: Bot, chat: BotChatTreeChat): Promise<ForkBotChatCloseResult> {
  return callBotRpc<ForkBotChatCloseResult>(bot, 'fork.botChat.close', {
    botId: bot.id,
    chatId: chat.chatId
  }).then((result) => {
    // Closed, it is no longer in the sidebar by itself; a stale hide for it is dropped.
    if (result.closed) {
      unhideBotChats([chat.chatId])
    }
    return result
  })
}
