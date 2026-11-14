// Idle recovery (FORK.md), item E1: `orca inbox`, through the host's fork.idleRecovery.* RPC.
// Contract: resolve an id prefix against the list, refuse a missing id or text with a usage
// error, and print through `inbox-format.ts`. No logic about verdicts or wakes lives here.
import type { CommandHandler, HandlerContext } from '../dispatch'
import { getOptionalStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import {
  FORK_IDLE_RECOVERY_METHODS as METHODS,
  type ForkIdleRecoveryAnswerResult,
  type ForkIdleRecoveryInboxResult,
  type ForkIdleRecoveryPauseResult
} from '../../shared/fork/idle-recovery-wire'
import { formatInboxAnswer, formatInboxList, formatInboxPause } from './inbox-format'

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

export const FORK_INBOX_HANDLERS: Record<string, CommandHandler> = {
  'inbox list': async (ctx) => {
    const reply = await ctx.client
      .call<ForkIdleRecoveryInboxResult>(METHODS.inbox, {})
      .catch(incompatible)
    printResult(reply, ctx.json, formatInboxList)
  },
  'inbox answer': async (ctx) => {
    const chatId = requireFlag(ctx, 'id', 'Name a chat: orca inbox list shows ids.')
    const text = requireFlag(ctx, 'text', 'Give the answer: orca inbox answer <id> <text>.')
    const reply = await ctx.client
      .call<ForkIdleRecoveryAnswerResult>(METHODS.answer, { chatId, text })
      .catch(incompatible)
    printResult(reply, ctx.json, formatInboxAnswer)
  },
  'inbox pause': async (ctx) => {
    const chatId = requireFlag(ctx, 'id', 'Name a chat: orca inbox list shows ids.')
    const paused = ctx.flags.get('resume') !== true
    const reply = await ctx.client
      .call<ForkIdleRecoveryPauseResult>(METHODS.pause, { chatId, paused })
      .catch(incompatible)
    printResult(reply, ctx.json, formatInboxPause)
  }
}
