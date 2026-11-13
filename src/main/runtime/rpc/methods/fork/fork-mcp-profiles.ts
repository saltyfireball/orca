// FORK.md "MCP profiles": the MCP servers and profiles for the CLI and paired
// clients. Each host answers for its own config and chats.
import { defineMethod } from '../../core'
import {
  ForkMcpChatParams,
  ForkMcpChatSetParams,
  ForkMcpListParams
} from '../../../../../shared/fork/mcp-profiles'
import {
  forkMcpChat,
  forkMcpList,
  forkMcpSetChat
} from '../../../../fork/mcp-profiles/mcp-profiles-service'

export const FORK_MCP_PROFILE_METHODS = [
  defineMethod({
    name: 'fork.mcpProfiles.list',
    permission: 'workspace',
    params: ForkMcpListParams,
    handler: async (params) => forkMcpList(params.folder)
  }),
  defineMethod({
    name: 'fork.mcpProfiles.chat',
    permission: 'workspace',
    params: ForkMcpChatParams,
    handler: async (params) => ({ chat: await forkMcpChat(params.sessionId) })
  }),
  defineMethod({
    name: 'fork.mcpProfiles.set',
    permission: 'workspace',
    params: ForkMcpChatSetParams,
    handler: async (params) => ({ chat: await forkMcpSetChat(params.sessionId, params.profile) })
  })
] as const
