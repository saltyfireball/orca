// Letters and the board (FORK.md, SLRM-2389): `orca letter` and `orca board`, through the host's
// fork.letters.* and fork.board.* RPC. The command names its own chat from its environment (a
// native chat's session id, a terminal agent's pane key); the host checks the claim.
import type { CommandHandler, HandlerContext } from '../dispatch/dispatch'
import { getOptionalStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import { readInjectedAgentSessionId } from '../../shared/agent-session/lifecycle/launch/agent-session-caller-env'
import { FORK_BOARD_ASK_TYPES, type ForkBoardAskType } from '../../shared/fork/letters'
import {
  FORK_LETTERS_METHODS as METHODS,
  type ForkBoardAddResult,
  type ForkBoardCloseResult,
  type ForkBoardListResult,
  type ForkLetterCallerClaim,
  type ForkLettersChatsResult,
  type ForkLettersListResult,
  type ForkLettersSendResult
} from '../../shared/fork/letters-wire'
import {
  formatBoardAsk,
  formatBoardList,
  formatLetterChats,
  formatLetterList,
  formatLetterSent
} from './letters-format'

function incompatible(error: unknown): never {
  if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
    throw new RuntimeClientError(
      'incompatible_runtime',
      'This Orca host has no letters or board. Update it to a Blackfish build with them.'
    )
  }
  throw error
}

function requireFlag(ctx: HandlerContext, name: string, hint: string): string {
  const value = getOptionalStringFlag(ctx.flags, name)
  if (!value?.trim()) {
    throw new RuntimeClientError('invalid_argument', hint)
  }
  return value
}

/** The chat that runs this command, as its environment says. */
export function forkLetterCallerClaim(
  env: Readonly<Record<string, string | undefined>> = process.env
): ForkLetterCallerClaim {
  const sessionId = readInjectedAgentSessionId(env)
  if (sessionId) {
    return { sessionId }
  }
  const paneKey = env.ORCA_PANE_KEY?.trim()
  return paneKey ? { paneKey } : undefined
}

function call<T>(ctx: HandlerContext, method: string, params: unknown) {
  return ctx.client.call<T>(method, params).catch(incompatible)
}

function askType(value: string): ForkBoardAskType {
  const upper = value.trim().toUpperCase()
  if (!(FORK_BOARD_ASK_TYPES as readonly string[]).includes(upper)) {
    throw new RuntimeClientError('invalid_argument', 'The type is REVIEW, DECIDE or DO.')
  }
  return upper as ForkBoardAskType
}

export const FORK_LETTERS_HANDLERS: Record<string, CommandHandler> = {
  'letter send': async (ctx) => {
    const to = requireFlag(ctx, 'to', 'Name a chat: orca letter chats lists ids.')
    const text = requireFlag(ctx, 'text', 'Give the text: orca letter send <to> <text>.')
    const cite = getOptionalStringFlag(ctx.flags, 'cite')
    const host = getOptionalStringFlag(ctx.flags, 'host')
    const from = forkLetterCallerClaim()
    const result = await call<ForkLettersSendResult>(ctx, METHODS.send, {
      to,
      text,
      ...(cite ? { cite } : {}),
      ...(host ? { host } : {}),
      ...(from ? { from } : {})
    })
    printResult(result, ctx.json, (value) => formatLetterSent(value.letter))
  },
  'letter list': async (ctx) => {
    const own = forkLetterCallerClaim()
    const chat = getOptionalStringFlag(ctx.flags, 'chat') ?? own?.sessionId ?? own?.paneKey
    const result = await call<ForkLettersListResult>(ctx, METHODS.list, chat ? { chat } : {})
    printResult(result, ctx.json, formatLetterList)
  },
  'letter chats': async (ctx) => {
    const result = await call<ForkLettersChatsResult>(ctx, METHODS.chats, {})
    printResult(result, ctx.json, formatLetterChats)
  },
  'board add': async (ctx) => {
    const type = askType(requireFlag(ctx, 'type', 'Give the type: REVIEW, DECIDE or DO.'))
    const title = requireFlag(ctx, 'title', 'Give a title: orca board add <type> <title>.')
    const body = getOptionalStringFlag(ctx.flags, 'body')
    const from = forkLetterCallerClaim()
    const result = await call<ForkBoardAddResult>(ctx, METHODS.boardAdd, {
      type,
      title,
      ...(body ? { body } : {}),
      ...(from ? { from } : {})
    })
    printResult(result, ctx.json, (value) => formatBoardAsk(value.ask))
  },
  'board list': async (ctx) => {
    const all = ctx.flags.get('all') === true
    const result = await call<ForkBoardListResult>(ctx, METHODS.boardList, all ? { all } : {})
    printResult(result, ctx.json, formatBoardList)
  },
  'board done': async (ctx) => {
    const id = requireFlag(ctx, 'id', 'Name an ask: orca board list shows ids.')
    const note = getOptionalStringFlag(ctx.flags, 'note')
    const from = forkLetterCallerClaim()
    const result = await call<ForkBoardCloseResult>(ctx, METHODS.boardClose, {
      id,
      action: 'done',
      ...(note ? { note } : {}),
      ...(from ? { from } : {})
    })
    printResult(result, ctx.json, (value) => formatBoardAsk(value.ask))
  },
  'board back': async (ctx) => {
    const id = requireFlag(ctx, 'id', 'Name an ask: orca board list shows ids.')
    const note = requireFlag(ctx, 'note', 'Say why: orca board back <id> <note>.')
    const from = forkLetterCallerClaim()
    const result = await call<ForkBoardCloseResult>(ctx, METHODS.boardClose, {
      id,
      action: 'back',
      note,
      ...(from ? { from } : {})
    })
    printResult(result, ctx.json, (value) => formatBoardAsk(value.ask))
  }
}
