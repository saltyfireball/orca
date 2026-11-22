// `orca bot chats-cleanup --include-remote` (FORK.md, BAD-734): every paired server closes its own
// bots' chats on its own timer; a manual run asks each to run its pass and lists what it answered.
import { mapWithConcurrency } from '../../../shared/concurrency/map-with-concurrency'
import {
  FORK_BOT_CHAT_CLEANUP_METHOD,
  FORK_BOT_CHAT_CLEANUP_SERVER_TIMEOUT_MS,
  parseForkBotChatCleanupResult,
  type ForkBotChatCleanupParams,
  type ForkBotChatCleanupResult
} from '../../../shared/fork/bot-chat-cleanup'

const SERVER_CONCURRENCY = 4

export type BotChatCleanupRemoteDeps = {
  listEnvironments: () =>
    | readonly { id: string; name: string }[]
    | Promise<readonly { id: string; name: string }[]>
  callEnvironment: (
    environmentId: string,
    method: string,
    params: unknown,
    timeoutMs: number
  ) => Promise<unknown>
}

function errorText(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'method_not_found'
  ) {
    return 'This server cannot close bot chats yet. Update it and try again.'
  }
  return error instanceof Error ? error.message : String(error)
}

export async function cleanUpBotChatsOnPairedServers(
  deps: BotChatCleanupRemoteDeps,
  params: ForkBotChatCleanupParams
): Promise<ForkBotChatCleanupResult['servers']> {
  const environments = await Promise.resolve(deps.listEnvironments()).catch(() => [])
  return mapWithConcurrency(environments, SERVER_CONCURRENCY, async (environment) => {
    const base = { name: environment.name, environmentId: environment.id }
    try {
      const answer = await deps.callEnvironment(
        environment.id,
        FORK_BOT_CHAT_CLEANUP_METHOD,
        { ...params, includeRemote: false },
        FORK_BOT_CHAT_CLEANUP_SERVER_TIMEOUT_MS
      )
      const result = parseForkBotChatCleanupResult(answer)
      return result
        ? {
            ...base,
            ok: true,
            rows: result.rows.map((row) => ({ ...row, server: environment.name }))
          }
        : { ...base, ok: false, error: 'unreadable answer', rows: [] }
    } catch (error) {
      return { ...base, ok: false, error: errorText(error), rows: [] }
    }
  })
}
