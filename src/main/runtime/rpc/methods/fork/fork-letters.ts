// Letters and the board (FORK.md, SLRM-2389): the RPC behind `orca letter`, `orca board`, paired
// hosts and the window's view of a paired server. A command's claimed chat is believed only when
// it came from this host; a request from a paired device is that device, never one of its chats.
import { defineMethod, type RpcContext } from '../../core'
import {
  FORK_LETTERS_METHODS as NAMES,
  ForkBoardAddParams,
  ForkBoardCloseParams,
  ForkBoardListParams,
  ForkLettersChatsParams,
  ForkLettersCollectParams,
  ForkLettersDeliverParams,
  ForkLettersListParams,
  ForkLettersSendParams,
  type ForkLetterCallerClaim,
  type ForkLettersSendResult
} from '../../../../../shared/fork/letters-wire'
import { formatLetterSent } from '../../../../../shared/fork/letters-receipt'
import {
  liveForkLetters,
  setForkLettersRuntime,
  type ForkLettersCaller,
  type ForkLettersDeps
} from '../../../../fork/letters/letters-deps'
import { ensureForkLettersRunner } from '../../../../fork/letters/letters-runner'
import {
  collectForkLetters,
  listForkLetters,
  receiveForkLetter,
  sendForkLetter
} from '../../../../fork/letters/letters-service'
import {
  addForkBoardAsk,
  closeForkBoardAsk,
  listForkBoardAsks
} from '../../../../fork/letters/board-service'
import { ensureStructuredHostInstalled } from '../structured-sessions/creation/structured-agent-session-gate'

async function deps(ctx: RpcContext): Promise<ForkLettersDeps> {
  setForkLettersRuntime(ctx.runtime)
  ensureForkLettersRunner()
  await ensureStructuredHostInstalled(ctx)
  return liveForkLetters()
}

function pairedDevice(ctx: RpcContext): string | null {
  return ctx.pairedDeviceId ?? (ctx.clientKind === 'mobile' ? 'mobile' : null)
}

function callerOf(ctx: RpcContext, claim: ForkLetterCallerClaim): ForkLettersCaller {
  const device = pairedDevice(ctx)
  return device ? { via: 'paired', deviceId: device } : { via: 'local', claim }
}

function requirePaired(ctx: RpcContext): string {
  const device = ctx.pairedDeviceId
  if (!device) {
    throw new Error('Only a paired device calls this method.')
  }
  return device
}

export const FORK_LETTERS_RPC_METHODS = [
  defineMethod({
    name: NAMES.send,
    permission: 'workspace',
    params: ForkLettersSendParams,
    handler: async (params, ctx): Promise<ForkLettersSendResult> => {
      const letter = await sendForkLetter(await deps(ctx), params, callerOf(ctx, params.from))
      // This host words the receipt (BAD-818): a sender's older CLI prints what happens here.
      return { letter, receipt: formatLetterSent(letter) }
    }
  }),
  defineMethod({
    name: NAMES.list,
    permission: 'workspace',
    params: ForkLettersListParams,
    handler: async (params, ctx) => listForkLetters(await deps(ctx), params.chat, params.limit)
  }),
  defineMethod({
    name: NAMES.chats,
    permission: 'workspace',
    params: ForkLettersChatsParams,
    handler: async (_params, ctx) => ({ chats: await (await deps(ctx)).chats() })
  }),
  defineMethod({
    name: NAMES.deliver,
    permission: 'workspace',
    params: ForkLettersDeliverParams,
    handler: async (params, ctx) => {
      const device = requirePaired(ctx)
      return { letter: await receiveForkLetter(await deps(ctx), params, device) }
    }
  }),
  defineMethod({
    name: NAMES.collect,
    permission: 'workspace',
    params: ForkLettersCollectParams,
    handler: async (_params, ctx) => {
      const device = requirePaired(ctx)
      return { letters: await collectForkLetters(await deps(ctx), device) }
    }
  }),
  defineMethod({
    name: NAMES.boardAdd,
    permission: 'workspace',
    params: ForkBoardAddParams,
    handler: async (params, ctx) => ({
      ask: await addForkBoardAsk(await deps(ctx), params, callerOf(ctx, params.from))
    })
  }),
  defineMethod({
    name: NAMES.boardList,
    permission: 'workspace',
    params: ForkBoardListParams,
    handler: async (params, ctx) => listForkBoardAsks(await deps(ctx), params.all === true)
  }),
  defineMethod({
    name: NAMES.boardClose,
    permission: 'workspace',
    params: ForkBoardCloseParams,
    handler: async (params, ctx) => ({
      ask: await closeForkBoardAsk(await deps(ctx), params, callerOf(ctx, params.from))
    })
  })
] as const
