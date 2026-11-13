// FORK.md "MCP profiles": `orca mcp-profile list|show|set`.
import { resolve } from 'node:path'
import type { CommandHandler, HandlerContext } from '../dispatch'
import { getOptionalStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import type { ForkMcpChatInfo, ForkMcpListing } from '../../shared/fork/mcp-profiles'
import { formatMcpChat, formatMcpListing } from './mcp-profile-format'

function call<T>(ctx: HandlerContext, method: string, params: unknown) {
  return ctx.client.call<T>(method, params).catch((error: unknown) => {
    if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
      throw new RuntimeClientError(
        'incompatible_runtime',
        'This Orca host has no MCP profiles. It needs a Blackfish build with MCP profiles.'
      )
    }
    throw error
  })
}

function required(ctx: HandlerContext, flag: string, what: string): string {
  const value = getOptionalStringFlag(ctx.flags, flag)?.trim()
  if (!value) {
    throw new RuntimeClientError('invalid_argument', `Name the ${what}.`)
  }
  return value
}

export const FORK_MCP_PROFILE_HANDLERS: Record<string, CommandHandler> = {
  'mcp-profile list': async (ctx) => {
    const folder = getOptionalStringFlag(ctx.flags, 'folder')
    const params = folder ? { folder: resolve(ctx.cwd, folder) } : {}
    printResult(
      await call<ForkMcpListing>(ctx, 'fork.mcpProfiles.list', params),
      ctx.json,
      formatMcpListing
    )
  },
  'mcp-profile show': async (ctx) => {
    const sessionId = required(ctx, 'session', 'chat: its session id')
    printResult(
      await call<{ chat: ForkMcpChatInfo | null }>(ctx, 'fork.mcpProfiles.chat', { sessionId }),
      ctx.json,
      formatMcpChat
    )
  },
  'mcp-profile set': async (ctx) => {
    const sessionId = required(ctx, 'session', 'chat: its session id')
    const name = required(ctx, 'profile', 'profile, or "default"')
    const profile = name === 'default' ? null : name
    printResult(
      await call<{ chat: ForkMcpChatInfo | null }>(ctx, 'fork.mcpProfiles.set', {
        sessionId,
        profile
      }),
      ctx.json,
      formatMcpChat
    )
  }
}
