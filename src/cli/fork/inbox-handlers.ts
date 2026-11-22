// Idle recovery (FORK.md), item E1: `orca inbox`, through the host's fork.idleRecovery.* RPC.
// Contract: resolve an id prefix against the list, refuse a missing id or text with a usage
// error, and print through `inbox-format.ts`. No logic about verdicts or wakes lives here.
import type { CommandHandler, HandlerContext } from '../dispatch/dispatch'
import { getOptionalStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import {
  FORK_IDLE_RECOVERY_METHODS as METHODS,
  type ForkIdleRecoveryAnswerResult,
  type ForkIdleRecoveryInboxItem,
  type ForkIdleRecoveryInboxResult,
  type ForkIdleRecoveryPauseResult
} from '../../shared/fork/idle-recovery-wire'
import {
  formatInboxAnswer,
  formatInboxList,
  formatInboxPause,
  inboxShortId,
  INBOX_OFF_MESSAGE
} from './inbox-format'

function incompatible(error: unknown): never {
  if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
    throw new RuntimeClientError(
      'incompatible_runtime',
      'This Orca host has no inbox commands. Update the desktop app and try again.'
    )
  }
  throw error
}

function requireFlag(ctx: HandlerContext, name: string, hint: string): string {
  const value = getOptionalStringFlag(ctx.flags, name)
  if (!value) {
    throw new RuntimeClientError('invalid_argument', hint)
  }
  return value
}

/** The one item an id or unique prefix names, else a usage error that lists the matches. */
export function pickInboxItem(
  items: readonly ForkIdleRecoveryInboxItem[],
  id: string
): ForkIdleRecoveryInboxItem {
  const exact = items.find((item) => item.chatId === id)
  if (exact) {
    return exact
  }
  const matches = items.filter((item) => item.chatId.startsWith(id))
  if (matches.length === 1) {
    return matches[0]
  }
  if (matches.length === 0) {
    throw new RuntimeClientError(
      'invalid_argument',
      `No chat in the inbox with id "${id}". orca inbox list shows ids.`
    )
  }
  const listed = matches.map((item) => `  ${inboxShortId(item)}  ${item.title}`).join('\n')
  throw new RuntimeClientError(
    'invalid_argument',
    `"${id}" matches ${matches.length} chats, type more of the id:\n${listed}`
  )
}

/** Reads the inbox and resolves the id; an empty inbox with idle recovery off says how to turn it on. */
async function resolveChatId(
  ctx: HandlerContext,
  id: string
): Promise<{ chatId: string; source?: ForkIdleRecoveryInboxItem['source'] }> {
  const { result } = await ctx.client
    .call<ForkIdleRecoveryInboxResult>(METHODS.inbox, {})
    .catch(incompatible)
  if (result.mode === 'off' && result.items.length === 0) {
    throw new RuntimeClientError('invalid_argument', INBOX_OFF_MESSAGE)
  }
  const item = pickInboxItem(result.items, id)
  // A PR babysitter row (SLRM-2386) is answered and stopped through its own source.
  return item.source ? { chatId: item.chatId, source: item.source } : { chatId: item.chatId }
}

export const FORK_INBOX_HANDLERS: Record<string, CommandHandler> = {
  'inbox list': async (ctx) => {
    const reply = await ctx.client
      .call<ForkIdleRecoveryInboxResult>(METHODS.inbox, {})
      .catch(incompatible)
    printResult(reply, ctx.json, formatInboxList)
  },
  'inbox answer': async (ctx) => {
    const id = requireFlag(ctx, 'id', 'Name a chat: orca inbox list shows ids.')
    const text = requireFlag(ctx, 'text', 'Give the answer: orca inbox answer <id> <text>.')
    const target = await resolveChatId(ctx, id)
    const reply = await ctx.client
      .call<ForkIdleRecoveryAnswerResult>(METHODS.answer, { ...target, text })
      .catch(incompatible)
    printResult(reply, ctx.json, formatInboxAnswer)
  },
  'inbox pause': async (ctx) => {
    const id = requireFlag(ctx, 'id', 'Name a chat: orca inbox list shows ids.')
    const paused = ctx.flags.get('resume') !== true
    const target = await resolveChatId(ctx, id)
    const reply = await ctx.client
      .call<ForkIdleRecoveryPauseResult>(METHODS.pause, { ...target, paused })
      .catch(incompatible)
    printResult(reply, ctx.json, formatInboxPause)
  }
}
