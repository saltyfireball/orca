// Chat handoff (FORK.md, SLRM-2391): `orca chat handoff` and `orca chat history`, through the
// host's fork.chatHandoff.* RPC.
import type { CommandHandler, HandlerContext } from '../dispatch/dispatch'
import {
  getOptionalPositiveIntegerFlag,
  getOptionalStringFlag,
  getPresentStringFlag
} from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import { readInjectedAgentSessionId } from '../../shared/agent-session/lifecycle/launch/agent-session-caller-env'
import { chatHandoffAgentLabel, isChatHandoffAgent } from '../../shared/fork/chat-handoff'
import {
  CHAT_HISTORY_MAX_LIMIT,
  type ChatHandoffResult,
  type ChatHistoryResult
} from '../../shared/fork/chat-handoff-wire'

function incompatible(error: unknown): never {
  if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
    throw new RuntimeClientError(
      'incompatible_runtime',
      'This Orca host cannot hand off chats. Update it and try again.'
    )
  }
  throw error
}

function chatId(ctx: HandlerContext): string {
  // An empty id must not fall back to this chat; the injected id is local-only.
  const id =
    getPresentStringFlag(ctx.flags, 'id') ??
    (ctx.client.isRemote ? undefined : readInjectedAgentSessionId())
  if (!id) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Name the chat by its session id (orca agent list shows them); outside a chat, or on a paired host, it is required.'
    )
  }
  return id
}

export function formatChatHandoff(result: ChatHandoffResult): string {
  if (result.status === 'refused') {
    return `Not handed off: ${result.message}`
  }
  const agent = chatHandoffAgentLabel(result.agent)
  const carried = `${result.entries} ${result.entries === 1 ? 'entry' : 'entries'} (${result.historyTokens} of ${result.budgetTokens} tokens)${result.omittedOlder ? ', older ones left to orca chat history' : ''}`
  if (result.status === 'planned') {
    return [
      `Would ${result.mode === 'continue' ? `continue ${result.name} on ${agent}` : `start a new ${agent} chat`} with ${carried}:`,
      '',
      result.message ?? ''
    ].join('\n')
  }
  const lines = [
    result.mode === 'continue'
      ? `Continued "${result.name}" on ${agent}${result.delivery === 'queued' ? ' (queued behind its turn)' : ''} with ${carried}.`
      : `Started "${result.name}" on ${agent} (${result.sessionId}) with ${carried}.`
  ]
  if (result.freshReason === 'context-full') {
    lines.push('The earlier chat of that agent had no room left, so a fresh chat started.')
  }
  if (result.stoppedSource) {
    lines.push("The source chat's turn was stopped first.")
  }
  if (result.cancelledLimitResume) {
    lines.push('The source chat will not resume at its usage limit reset.')
  }
  return lines.join('\n')
}

export function formatChatHistory(result: ChatHistoryResult): string {
  if (result.entries.length === 0) {
    return `No entries in "${result.name}" before that point.`
  }
  const body = result.entries.map(
    (entry) => `[#${entry.seq} ${entry.role}]${entry.cut ? ' (cut)' : ''} ${entry.text}`
  )
  const more =
    result.nextBefore !== null
      ? `Older entries: orca chat history ${result.sessionId} --before ${result.nextBefore}`
      : 'This is the start of the chat.'
  return [...body, '', more].join('\n')
}

export const FORK_CHAT_HANDOFF_HANDLERS: Record<string, CommandHandler> = {
  'chat handoff': async (ctx) => {
    const to = getOptionalStringFlag(ctx.flags, 'to')
    if (!isChatHandoffAgent(to)) {
      throw new RuntimeClientError('invalid_argument', '--to takes codex or claude.')
    }
    const request = getOptionalStringFlag(ctx.flags, 'message')
    const flag = (name: string): true | undefined =>
      ctx.flags.get(name) === true ? true : undefined
    const reply = await ctx.client
      .call<ChatHandoffResult>('fork.chatHandoff.start', {
        sessionId: chatId(ctx),
        to,
        ...(request ? { request } : {}),
        ...(flag('fresh') ? { fresh: true } : {}),
        ...(flag('stop') ? { stop: true } : {}),
        ...(flag('focus') ? { focus: true } : {}),
        ...(flag('dry-run') ? { dryRun: true } : {})
      })
      .catch(incompatible)
    printResult(reply, ctx.json, formatChatHandoff)
    if (reply.result.status === 'refused') {
      process.exitCode = 1
    }
  },
  'chat history': async (ctx) => {
    const before = getOptionalPositiveIntegerFlag(ctx.flags, 'before')
    const limit = getOptionalPositiveIntegerFlag(ctx.flags, 'limit')
    if (limit !== undefined && limit > CHAT_HISTORY_MAX_LIMIT) {
      throw new RuntimeClientError(
        'invalid_argument',
        `--limit can be at most ${CHAT_HISTORY_MAX_LIMIT}.`
      )
    }
    const reply = await ctx.client
      .call<ChatHistoryResult>('fork.chatHandoff.history', {
        sessionId: chatId(ctx),
        ...(before !== undefined ? { before } : {}),
        ...(limit !== undefined ? { limit } : {})
      })
      .catch(incompatible)
    printResult(reply, ctx.json, formatChatHistory)
  }
}
