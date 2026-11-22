// Owner token (BAD-737, FORK.md): a secret the owner mints in Settings that lets a tool outside Orca
// (an MCP server) answer or comment on a bot's item as the owner, and nothing else. None exists until
// minted; the host keeps only its hash.
import * as z from 'zod'

export const FORK_OWNER_TOKEN_STATUS_METHOD = 'fork.ownerToken.status'
export const FORK_OWNER_TOKEN_MINT_METHOD = 'fork.ownerToken.mint'
export const FORK_OWNER_TOKEN_REVOKE_METHOD = 'fork.ownerToken.revoke'
/** `orca bot item answer`: bots.items.owner.comment, authorized by the token. */
export const FORK_OWNER_ITEM_ANSWER_METHOD = 'fork.botItems.ownerAnswer'

/** The environment variable `orca bot item answer` reads the token from. */
export const FORK_OWNER_TOKEN_ENV = 'ORCA_OWNER_TOKEN'
export const FORK_OWNER_TOKEN_PREFIX = 'orcaown_'
/** The device an owner-token answer records, so the thread and the log tell it apart. */
export const FORK_OWNER_TOKEN_DEVICE = 'owner-token'
/** The line an owner-token answer ends with in the item's thread. */
export const FORK_OWNER_TOKEN_MARK = '_Answered via owner token._'

export const ForkOwnerTokenEmptyParams = z.object({})

export const ForkOwnerItemAnswerParams = z
  .object({
    ownerToken: z.string().min(1).max(200),
    item: z.string().trim().min(1).max(128),
    text: z.string().max(20_000),
    /** The bot the item must belong to; refused when it is another bot's. */
    botId: z.string().min(1).max(128).optional(),
    /** The question event this answers (e12): refused if the bot has since asked another. */
    questionId: z.string().min(1).max(128).optional(),
    /** A comment that answers no question: a Needs you item keeps waiting. */
    plain: z.literal(true).optional(),
    /** The caller's id for this answer: a repeat returns the comment already made. */
    requestId: z.string().min(1).max(128).optional()
  })
  .refine((value) => value.text.trim().length > 0, 'Missing text')

export type ForkOwnerTokenStatus = { exists: boolean; createdAt: number | null }

/** The token is in this answer only, once; it is never shown or stored again. */
export type ForkOwnerTokenMintResult = { token: string; createdAt: number }

export type ForkOwnerItemAnswerResult = {
  eventId: string | null
  item: { number: number; status: string; owner: string | null }
}
