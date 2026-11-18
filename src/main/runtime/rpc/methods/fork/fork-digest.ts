// Digest (SLRM-2388, FORK.md): fork.digest.local answers for this host alone (the desktop asks
// each paired server for it); fork.digest.collect reads this host and every paired server, for
// `orca digest`, the desktop dialog and the phone. Read-only.
import { defineMethod } from '../../core'
import {
  FORK_DIGEST_COLLECT_METHOD,
  FORK_DIGEST_LOCAL_METHOD,
  ForkDigestCollectParams,
  ForkDigestLocalParams
} from '../../../../../shared/fork/digest'
import {
  collectForkDigestOn,
  readForkDigestLocalPart
} from '../../../../fork/digest/digest-runtime'

export const FORK_DIGEST_METHODS = [
  defineMethod({
    name: FORK_DIGEST_LOCAL_METHOD,
    permission: 'workspace',
    params: ForkDigestLocalParams,
    handler: async (params, ctx) => readForkDigestLocalPart(ctx.runtime, params)
  }),
  defineMethod({
    name: FORK_DIGEST_COLLECT_METHOD,
    permission: 'workspace',
    params: ForkDigestCollectParams,
    handler: async (params, ctx) => collectForkDigestOn(ctx.runtime, params)
  })
] as const
