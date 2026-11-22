// Owner token (BAD-737, FORK.md): `orca bot item answer`, the owner's comment on a bot's item from any
// shell (an MCP server, a script), authorized by the owner token instead of a bot's chat or terminal.
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { CommandHandler, HandlerContext } from '../dispatch/dispatch'
import { getOptionalStringFlag, getRequiredStringFlag } from '../arguments/flags'
import { readTextOrFileFlag } from '../arguments/command-body-input'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import { findBot } from '../bots/bot'
import {
  FORK_OWNER_ITEM_ANSWER_METHOD,
  FORK_OWNER_TOKEN_ENV,
  type ForkOwnerItemAnswerResult
} from '../../shared/fork/owner-token'

const NO_TOKEN = `No owner token: pass --owner-token-file <path> or set ${FORK_OWNER_TOKEN_ENV}. Your owner mints one in Settings > Blackfish > Owner token.`

/** The token from --owner-token-file (owner-only mode, never group or world readable) or the env. */
export async function readOwnerToken(
  flags: HandlerContext['flags'],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): Promise<string> {
  const file = getOptionalStringFlag(flags, 'owner-token-file')
  if (file) {
    const path = resolve(cwd, file)
    const info = await stat(path).catch(() => null)
    if (!info?.isFile()) {
      throw new RuntimeClientError('invalid_argument', `--owner-token-file: no file at ${path}.`)
    }
    // Why: Windows has no POSIX mode bits; its ACLs are the user's to set.
    if (platform !== 'win32' && (info.mode & 0o077) !== 0) {
      throw new RuntimeClientError(
        'invalid_argument',
        `--owner-token-file: ${path} is readable by others. Run \`chmod 600\` on it first; it was not read.`
      )
    }
    const token = (await readFile(path, 'utf8')).trim()
    if (!token) {
      throw new RuntimeClientError('invalid_argument', `--owner-token-file: ${path} is empty.`)
    }
    return token
  }
  const token = env[FORK_OWNER_TOKEN_ENV]?.trim()
  if (!token) {
    throw new RuntimeClientError('invalid_argument', NO_TOKEN)
  }
  return token
}

function jsonStatus(status: string): string {
  return status === 'working' ? 'in_progress' : status
}

export const FORK_BOT_ITEM_ANSWER_HANDLERS: Record<string, CommandHandler> = {
  'bot item answer': async (ctx) => {
    const { flags, cwd, client, json } = ctx
    const selector = getOptionalStringFlag(flags, 'bot')
    const botId = selector ? (await findBot(client, selector)).id : undefined
    const question = getOptionalStringFlag(flags, 'question')
    const requestId = getOptionalStringFlag(flags, 'request-id')
    const response = await client.call<ForkOwnerItemAnswerResult>(FORK_OWNER_ITEM_ANSWER_METHOD, {
      ownerToken: await readOwnerToken(flags, cwd),
      item: getRequiredStringFlag(flags, 'id'),
      text: (await readTextOrFileFlag(flags, cwd, 'text', true)) ?? '',
      ...(botId ? { botId } : {}),
      ...(question ? { questionId: question } : {}),
      ...(flags.has('plain') ? { plain: true } : {}),
      ...(requestId ? { requestId } : {})
    })
    const result = response.result
    printResult(
      {
        ...response,
        result: { ...result, item: { ...result.item, status: jsonStatus(result.item.status) } }
      },
      json,
      (value) =>
        `Answered item ${value.item.number}${value.item.owner ? ` (${value.item.owner})` : ''} as your owner; it is ${value.item.status.replace('_', ' ')} now.`
    )
  }
}
