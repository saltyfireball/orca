// BAD-734 (FORK.md "Auto-close finished bot chats"): `orca bot chats-cleanup`, through the host's
// fork.botChat.cleanup RPC. The host closes what the rule ends; this prints what and why.
import type { CommandHandler } from '../dispatch/dispatch'
import { getOptionalStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import {
  FORK_BOT_CHAT_CLEANUP_METHOD,
  forkBotChatCloseReasonText,
  type ForkBotChatCleanupResult,
  type ForkBotChatCleanupRow
} from '../../shared/fork/bot-chat-cleanup'

function verdictText(row: ForkBotChatCleanupRow, dryRun: boolean): string {
  if (row.outcome === 'failed') {
    return `failed: ${row.error ?? 'unknown error'}`
  }
  return dryRun ? 'would close' : 'closed'
}

export function formatBotChatCleanup(result: ForkBotChatCleanupResult): string {
  const rows = [...result.rows, ...result.servers.flatMap((server) => server.rows)]
  const lines: string[] = []
  if (!result.enabled) {
    lines.push('Auto-close is off (forkBotChatAutoClose). This is what the rule would close.')
  }
  if (rows.length === 0) {
    lines.push('No finished bot chats to close.')
  } else {
    for (const row of rows) {
      const place = row.server ? `${row.server}/${row.botName}` : row.botName
      lines.push(
        `${verdictText(row, result.dryRun)}  ${place}  ${row.chatId}  ${row.title}  (${forkBotChatCloseReasonText(row.reason)})`
      )
    }
  }
  for (const server of result.servers) {
    if (!server.ok) {
      lines.push(`Note: ${server.name}: not checked: ${server.error ?? 'no answer'}`)
    }
  }
  const count = rows.filter((row) => row.outcome !== 'failed').length
  lines.push(
    result.dryRun
      ? `Dry run: ${count} would close. Nothing was changed.`
      : `${count} closed. Their history stays in each bot's Chats tab.`
  )
  return lines.join('\n')
}

export const FORK_BOT_CHAT_CLEANUP_HANDLERS: Record<string, CommandHandler> = {
  'bot chats-cleanup': async (ctx) => {
    const bot = getOptionalStringFlag(ctx.flags, 'bot')
    const result = await ctx.client
      .call<ForkBotChatCleanupResult>(FORK_BOT_CHAT_CLEANUP_METHOD, {
        ...(bot ? { bot } : {}),
        dryRun: ctx.flags.has('dry-run'),
        includeRemote: ctx.flags.has('include-remote')
      })
      .catch((error: unknown) => {
        if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
          throw new RuntimeClientError(
            'incompatible_runtime',
            'This Orca host cannot close bot chats yet. Update it and try again.'
          )
        }
        throw error
      })
    printResult(result, ctx.json, formatBotChatCleanup)
  }
}
