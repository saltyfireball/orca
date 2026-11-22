// Chat handoff (FORK.md, SLRM-2391): hand a native chat to the other agent, and read a chat's
// history by entry number (`orca chat handoff`, `orca chat history`, the tab menu). Each host hands
// off and reads its own chats, so the CLI reaches a paired host's chats with --environment.
import { defineMethod, type RpcContext } from '../../core'
import type { OrcadFeature } from '../../startup/orcad-readiness'
import {
  ForkChatHandoffStartParams,
  ForkChatHistoryParams,
  type ChatHandoffResult,
  type ChatHistoryResult
} from '../../../../../shared/fork/chat-handoff-wire'
import { chatHandoffName } from '../../../../../shared/fork/chat-handoff-select'
import {
  forkChatHandoffService,
  requireChatHandoffHost
} from '../../../../fork/chat-handoff/chat-handoff-host'
import { readChatHistoryPage } from '../../../../fork/chat-handoff/chat-handoff-history'
import { FORK_SESSION_EXPORT_METHODS } from './fork-session-export'
import { ensureStructuredHostInstalled } from '../structured-sessions/creation/structured-agent-session-gate'

// A handoff creates a chat, which needs the accounts feature on orcad, as agentSession.create does.
const requires = ['accounts'] satisfies OrcadFeature[]

async function service(ctx: RpcContext) {
  await ensureStructuredHostInstalled(ctx)
  return forkChatHandoffService(ctx.runtime)
}

// BAD-688: the session export read rides along, so rpc-method-registry.ts is untouched.
export const FORK_CHAT_HANDOFF_METHODS = [
  ...FORK_SESSION_EXPORT_METHODS,
  defineMethod({
    name: 'fork.chatHandoff.start',
    permission: 'workspace',
    params: ForkChatHandoffStartParams,
    requires,
    handler: async (params, ctx): Promise<ChatHandoffResult> => (await service(ctx)).start(params)
  }),
  defineMethod({
    name: 'fork.chatHandoff.history',
    permission: 'workspace',
    params: ForkChatHistoryParams,
    handler: async (params, ctx): Promise<ChatHistoryResult> => {
      await ensureStructuredHostInstalled(ctx)
      const host = await requireChatHandoffHost(ctx.runtime)
      const record = host.deps.store.getRecord(params.sessionId)
      if (!record) {
        throw new Error(`No chat with session id ${params.sessionId} on this host.`)
      }
      const page = await readChatHistoryPage(host, params.sessionId, params)
      return {
        sessionId: params.sessionId,
        agent: record.provider,
        name: chatHandoffName(record.conversationName, record.provider),
        ...page
      }
    }
  })
] as const
