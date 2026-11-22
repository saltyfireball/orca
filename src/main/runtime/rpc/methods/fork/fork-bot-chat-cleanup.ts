// BAD-734 (FORK.md "Auto-close finished bot chats"): `fork.botChat.cleanup`, the manual pass behind
// `orca bot chats-cleanup`, and `fork.botChat.older`, the closed chats a client pages in.
import { defineMethod, type RpcContext } from '../../core'
import { getAppEnvironment } from '../../../../../shared/app-lifecycle/app-environment'
import { listEnvironments } from '../../../../../shared/remote-runtime/host-store/runtime-environment-store'
import {
  FORK_BOT_CHAT_CLEANUP_METHOD,
  ForkBotChatCleanupParams,
  type ForkBotChatCleanupResult
} from '../../../../../shared/fork/bot-chat-cleanup'
import {
  FORK_BOT_CHAT_OLDER_METHOD,
  ForkBotChatOlderParams,
  forkOlderBotChats
} from '../../../../../shared/fork/bot-chat-list-filter'
import { readSharedBotChatTree } from '../../../../bots/bot-chat-tree-host'
import { cleanUpBotChatsOnPairedServers } from '../../../../fork/bot-chat-close/bot-chat-cleanup-remote'
import { runForkBotChatCleanupLocal } from '../../../../fork/bot-chat-close/bot-chat-auto-close-service'
import { boundedForkPairedCall } from '../../../../fork/paired-server-call/paired-server-call'

async function withServers(
  local: ForkBotChatCleanupResult,
  params: ForkBotChatCleanupParams,
  ctx: RpcContext
): Promise<ForkBotChatCleanupResult> {
  const call = boundedForkPairedCall((environmentId, method, callParams, timeoutMs) =>
    ctx.runtime.callOrchestrationWorkerServer(environmentId, method, callParams, timeoutMs)
  )
  const servers = await cleanUpBotChatsOnPairedServers(
    {
      listEnvironments: () => listEnvironments(getAppEnvironment().getPath('userData')),
      callEnvironment: call
    },
    params
  )
  return { ...local, servers }
}

export const FORK_BOT_CHAT_CLEANUP_METHODS = [
  defineMethod({
    name: FORK_BOT_CHAT_CLEANUP_METHOD,
    permission: 'workspace',
    params: ForkBotChatCleanupParams,
    handler: async (params, ctx): Promise<ForkBotChatCleanupResult> => {
      const dryRun = params.dryRun === true
      const { enabled, rows } = await runForkBotChatCleanupLocal(ctx.runtime, {
        dryRun,
        ...(params.bot !== undefined ? { bot: params.bot } : {})
      })
      const local: ForkBotChatCleanupResult = { dryRun, enabled, rows, servers: [] }
      return params.includeRemote ? withServers(local, params, ctx) : local
    }
  }),
  defineMethod({
    name: FORK_BOT_CHAT_OLDER_METHOD,
    permission: 'workspace',
    params: ForkBotChatOlderParams,
    handler: async (params, { runtime }) =>
      forkOlderBotChats(await readSharedBotChatTree(runtime, { botId: params.botId }), params)
  })
] as const
