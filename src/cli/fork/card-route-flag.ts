// Card routing (BAD-694, FORK.md): `worker-start --card <KEY>` links a new workspace to its Linear
// card. A host without it drops the param, as it does any param it does not know.
import { isCardKey } from '../../shared/fork/card-routing'
import { getOptionalStringFlag } from '../arguments/flags'
import { RuntimeClientError } from '../runtime/connection/types'

export const FORK_CARD_FLAG = 'card'

export function readForkCardFlag(flags: Map<string, string | boolean>): { forkCard?: string } {
  if (!flags.has(FORK_CARD_FLAG)) {
    return {}
  }
  const key = getOptionalStringFlag(flags, FORK_CARD_FLAG)?.trim()
  if (!key || !isCardKey(key)) {
    throw new RuntimeClientError('invalid_argument', '--card takes a Linear card key like BAD-12.')
  }
  return { forkCard: key.toUpperCase() }
}
