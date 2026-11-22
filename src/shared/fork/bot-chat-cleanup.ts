// `orca bot chats-cleanup` and `fork.botChat.cleanup` (FORK.md, BAD-734): the wire shape of a pass
// that closes (or, as a dry run, lists) the bot chats the auto-close rule ends.
import * as z from 'zod'
import type { ForkBotChatCloseReason, ForkBotChatKeepReason } from './bot-chat-auto-close'

export const FORK_BOT_CHAT_CLEANUP_METHOD = 'fork.botChat.cleanup'
export const FORK_BOT_CHAT_CLEANUP_SERVER_TIMEOUT_MS = 120_000

export const ForkBotChatCleanupParams = z.object({
  bot: z.string().min(1).max(256).optional(),
  dryRun: z.boolean().optional(),
  includeRemote: z.boolean().optional()
})
export type ForkBotChatCleanupParams = z.infer<typeof ForkBotChatCleanupParams>

export type ForkBotChatCleanupRow = {
  botId: string
  botName: string
  chatId: string
  title: string
  outcome: 'closed' | 'would-close' | 'kept' | 'failed'
  reason?: ForkBotChatCloseReason
  keep?: ForkBotChatKeepReason
  cardKey?: string
  error?: string
  server?: string
}

export type ForkBotChatCleanupResult = {
  dryRun: boolean
  enabled: boolean
  rows: ForkBotChatCleanupRow[]
  servers: {
    name: string
    environmentId: string
    ok: boolean
    error?: string
    rows: ForkBotChatCleanupRow[]
  }[]
}

const Row = z.object({
  botId: z.string(),
  botName: z.string(),
  chatId: z.string(),
  title: z.string(),
  outcome: z.enum(['closed', 'would-close', 'kept', 'failed']),
  reason: z.string().optional(),
  keep: z.string().optional(),
  cardKey: z.string().optional(),
  error: z.string().optional(),
  server: z.string().optional()
})

const Result = z.object({ dryRun: z.boolean(), enabled: z.boolean(), rows: z.array(Row) })

/** A paired server's answer; one from another build that does not read as a result is dropped. */
export function parseForkBotChatCleanupResult(value: unknown): ForkBotChatCleanupResult | null {
  const parsed = Result.safeParse(value)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: reason and keep strings from another build only reach a label lookup.
  return parsed.success ? ({ ...parsed.data, servers: [] } as ForkBotChatCleanupResult) : null
}

const REASON_TEXT: Record<ForkBotChatCloseReason, string> = {
  'card-finished': 'its card is done or canceled',
  'job-ended': 'it finished and reported back',
  idle: 'it has been idle too long'
}

export function forkBotChatCloseReasonText(reason: ForkBotChatCloseReason | undefined): string {
  return reason ? REASON_TEXT[reason] : 'unknown'
}
