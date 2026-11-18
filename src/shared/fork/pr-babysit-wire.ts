// PR babysitter (FORK.md, SLRM-2386): the runtime RPC names and payloads `orca babysit` and the
// window use. Each host answers for the chats that run on it.
import { z } from 'zod'
import type { PrBabysitEntry } from './pr-babysit'

export const FORK_PR_BABYSIT_METHODS = {
  /** Every babysat pull request on this host with its state. */
  list: 'fork.prBabysit.list',
  /** Babysit one pull request, or start it over (fresh rounds, out of the inbox). */
  start: 'fork.prBabysit.start',
  /** Stop babysitting one pull request. */
  stop: 'fork.prBabysit.stop'
} as const

/** `host/owner/repo#number`, `owner/repo#number` or a pull request URL. */
const Target = z.string().min(3).max(500)

export const ForkPrBabysitListParams = z.object({})
export const ForkPrBabysitStartParams = z.object({ pr: Target })
export const ForkPrBabysitStopParams = z.object({ pr: Target })

export type ForkPrBabysitListResult = {
  now: number
  /** True when the Settings repo list names at least one repository. */
  reposOn: boolean
  autoMerge: boolean
  maxRounds: number
  entries: PrBabysitEntry[]
}

/**
 * - started: babysat from now on (or started over).
 * - stopped: it was babysat and is not now.
 * - not-babysat: stop for a pull request it was not babysitting.
 * - invalid: not a pull request it can read.
 */
export type ForkPrBabysitChangeOutcome = 'started' | 'stopped' | 'not-babysat' | 'invalid'

export type ForkPrBabysitChangeResult = {
  prKey: string | null
  result: ForkPrBabysitChangeOutcome
  entry: PrBabysitEntry | null
}
