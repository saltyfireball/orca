// SLRM-2388 (FORK.md "Digest"): `orca digest`, through fork.digest.collect.
import type { CommandHandler } from '../dispatch/dispatch'
import { getOptionalStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import {
  FORK_DIGEST_CALL_TIMEOUT_MS,
  FORK_DIGEST_COLLECT_METHOD,
  parseForkDigestSince,
  type ForkDigest
} from '../../shared/fork/digest'
import { formatForkDigestText } from '../../shared/fork/digest-format'

export function readDigestSince(value: string | undefined, now: number): number | undefined {
  if (value === undefined) {
    return undefined
  }
  const since = parseForkDigestSince(value, now)
  if (since === null) {
    throw new RuntimeClientError(
      'invalid_argument',
      '--since takes a duration (90m, 12h, 2d, 1w) or a past date and time (2026-11-18T07:00).'
    )
  }
  return Math.max(0, Math.floor(since))
}

export const FORK_DIGEST_HANDLERS: Record<string, CommandHandler> = {
  digest: async (ctx) => {
    const since = readDigestSince(getOptionalStringFlag(ctx.flags, 'since'), Date.now())
    const result = await ctx.client
      .call<ForkDigest>(FORK_DIGEST_COLLECT_METHOD, since === undefined ? {} : { since }, {
        timeoutMs: FORK_DIGEST_CALL_TIMEOUT_MS
      })
      .catch((error: unknown) => {
        if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
          throw new RuntimeClientError(
            'incompatible_runtime',
            'This Orca host has no digest. It needs a Blackfish build with SLRM-2388.'
          )
        }
        throw error
      })
    printResult(result, ctx.json, formatForkDigestText)
  }
}
