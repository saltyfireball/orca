// Owner token (BAD-737, FORK.md): mint, revoke and read it from the owner's Settings (an agent's CLI is
// refused), and `orca bot item answer`, the one write it allows: the owner's comment on an item.
import { getAppEnvironment } from '../../../../../shared/app-lifecycle/app-environment'
import {
  FORK_OWNER_ITEM_ANSWER_METHOD,
  FORK_OWNER_TOKEN_DEVICE,
  FORK_OWNER_TOKEN_MARK,
  FORK_OWNER_TOKEN_MINT_METHOD,
  FORK_OWNER_TOKEN_REVOKE_METHOD,
  FORK_OWNER_TOKEN_STATUS_METHOD,
  ForkOwnerItemAnswerParams,
  ForkOwnerTokenEmptyParams,
  type ForkOwnerItemAnswerResult
} from '../../../../../shared/fork/owner-token'
import { OwnerTokenStore } from '../../../../fork/owner-token/owner-token-store'
import { BotItemError } from '../../../../bots/bot-item-error'
import { defineMethod, InvalidArgumentError } from '../../core'
import { ownerOnly } from '../bots-caller-gates'
import { ownerItemComment } from '../bots-items-owner-comment'
import { resolveItem } from '../bots-items-write-support'

const REFUSAL = 'Only your owner mints or revokes the owner token, in Settings > Blackfish.'
const BAD_TOKEN = 'The owner token is missing, wrong or revoked. Nothing was posted.'

let defaultStore: OwnerTokenStore | null = null

function userDataTokens(): OwnerTokenStore {
  defaultStore ??= new OwnerTokenStore(getAppEnvironment().getPath('userData'))
  return defaultStore
}

export const forkOwnerTokenMethods = (tokens: () => OwnerTokenStore = userDataTokens) => [
  defineMethod({
    name: FORK_OWNER_TOKEN_STATUS_METHOD,
    permission: 'workspace',
    params: ForkOwnerTokenEmptyParams,
    handler: async (_params, context) => {
      ownerOnly(context, REFUSAL)
      return tokens().status()
    }
  }),
  defineMethod({
    name: FORK_OWNER_TOKEN_MINT_METHOD,
    permission: 'workspace',
    params: ForkOwnerTokenEmptyParams,
    handler: async (_params, context) => {
      ownerOnly(context, REFUSAL)
      const minted = tokens().mint()
      console.info('[owner-token] minted a new owner token; any earlier one stops working')
      return minted
    }
  }),
  defineMethod({
    name: FORK_OWNER_TOKEN_REVOKE_METHOD,
    permission: 'workspace',
    params: ForkOwnerTokenEmptyParams,
    handler: async (_params, context) => {
      ownerOnly(context, REFUSAL)
      const revoked = tokens().revoke()
      console.info('[owner-token] revoked the owner token')
      return { revoked }
    }
  }),
  defineMethod({
    name: FORK_OWNER_ITEM_ANSWER_METHOD,
    permission: 'workspace',
    params: ForkOwnerItemAnswerParams,
    handler: async (params, context): Promise<ForkOwnerItemAnswerResult> => {
      if (!tokens().verify(params.ownerToken)) {
        console.warn('[owner-token] refused an item answer: the token did not match')
        throw new InvalidArgumentError(BAD_TOKEN)
      }
      const { runtime } = context
      runtime.bots.assertEnabled()
      const store = runtime.botItems.store()
      const item = await resolveItem(store, params.item)
      if (params.botId !== undefined && item.ownerBotId !== params.botId) {
        throw new BotItemError(
          'invalid_argument',
          `Item ${item.number} belongs to another bot. Nothing was posted.`
        )
      }
      const { eventId } = await ownerItemComment(
        {
          item: item.uid,
          text: `${params.text.trimEnd()}\n\n${FORK_OWNER_TOKEN_MARK}`,
          ...(params.questionId !== undefined ? { questionId: params.questionId } : {}),
          ...(params.plain ? { plain: true as const } : {}),
          ...(params.requestId !== undefined ? { requestId: params.requestId } : {})
        },
        context,
        { kind: 'owner', device: FORK_OWNER_TOKEN_DEVICE }
      )
      const after = await resolveItem(store, item.uid)
      const owner = runtime.bots.list().find((bot) => bot.id === after.ownerBotId)?.name ?? null
      console.info(
        `[owner-token] item ${after.number} (${owner ?? after.ownerBotId}) answered via owner token, event ${eventId ?? 'none'}`
      )
      return { eventId, item: { number: after.number, status: after.status, owner } }
    }
  })
]

export const FORK_OWNER_TOKEN_METHODS = forkOwnerTokenMethods()
