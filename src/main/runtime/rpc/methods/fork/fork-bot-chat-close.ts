// BAD-669 (FORK.md "Hide and close bot chats"): `fork.botChat.close`, the sidebar's Close chat.
import { defineMethod } from '../../core'
import { ForkBotChatCloseParams } from '../../../../../shared/fork/bot-chat-hide'
import { readSharedBotChatTree } from '../../../../bots/bot-chat-tree-host'
import { closeForkBotChat } from '../../../../fork/bot-chat-close/bot-chat-close'
import { closeStructuredAgentSessionChild } from '../../../agent-session/lifecycle/structured-agent-session-close'

export const FORK_BOT_CHAT_CLOSE_METHODS = [
  defineMethod({
    name: 'fork.botChat.close',
    permission: 'workspace',
    params: ForkBotChatCloseParams,
    handler: (params, { runtime }) =>
      closeForkBotChat(
        {
          readChats: async (botId) => (await readSharedBotChatTree(runtime, { botId })).chats,
          closeSession: (sessionId) => closeStructuredAgentSessionChild(sessionId, { runtime })
        },
        params
      )
  })
] as const
