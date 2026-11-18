// PR babysitter (FORK.md, SLRM-2386): `orca babysit`, through the host's fork.prBabysit.* RPC.
import type { CommandHandler, HandlerContext } from '../dispatch/dispatch'
import { getOptionalStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import { prBabysitStatusText } from '../../shared/fork/pr-babysit'
import {
  FORK_PR_BABYSIT_METHODS as METHODS,
  type ForkPrBabysitChangeResult,
  type ForkPrBabysitListResult
} from '../../shared/fork/pr-babysit-wire'

function incompatible(error: unknown): never {
  if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
    throw new RuntimeClientError(
      'incompatible_runtime',
      'This Orca host has no babysit commands. Update it and try again.'
    )
  }
  throw error
}

function requirePr(ctx: HandlerContext): string {
  const pr = getOptionalStringFlag(ctx.flags, 'pr')
  if (!pr) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Name a pull request: its URL or owner/repo#12.'
    )
  }
  return pr
}

export function formatBabysitList(result: ForkPrBabysitListResult): string {
  const head = [
    `Repos in Settings: ${result.reposOn ? 'yes' : 'none'}`,
    `auto-merge: ${result.autoMerge ? 'on' : 'off'}`,
    `rounds: ${result.maxRounds}`
  ].join(', ')
  if (result.entries.length === 0) {
    return `${head}\nNo pull request is babysat on this host.`
  }
  return [
    head,
    ...result.entries.map(
      (entry) =>
        `  ${entry.prKey}  ${prBabysitStatusText(entry, result.maxRounds)}${entry.source === 'cli' ? '' : '  (repo list)'}`
    )
  ].join('\n')
}

export function formatBabysitChange(result: ForkPrBabysitChangeResult): string {
  switch (result.result) {
    case 'invalid':
      return 'Not a pull request: give its URL, owner/repo#12 or host/owner/repo#12.'
    case 'not-babysat':
      return `${result.prKey}: was not babysat.`
    case 'stopped':
      return `${result.prKey}: no longer babysat.`
    case 'started':
      return `${result.prKey}: babysat. It acts on the next CI result its chat gets.`
  }
}

async function change(ctx: HandlerContext, method: string): Promise<void> {
  const reply = await ctx.client
    .call<ForkPrBabysitChangeResult>(method, { pr: requirePr(ctx) })
    .catch(incompatible)
  if (reply.result.result === 'invalid') {
    throw new RuntimeClientError('invalid_argument', formatBabysitChange(reply.result))
  }
  printResult(reply, ctx.json, formatBabysitChange)
}

export const FORK_BABYSIT_HANDLERS: Record<string, CommandHandler> = {
  'babysit list': async (ctx) => {
    const reply = await ctx.client
      .call<ForkPrBabysitListResult>(METHODS.list, {})
      .catch(incompatible)
    printResult(reply, ctx.json, formatBabysitList)
  },
  'babysit stop': (ctx) => change(ctx, METHODS.stop),
  babysit: (ctx) => change(ctx, METHODS.start)
}
