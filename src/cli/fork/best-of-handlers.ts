// Best of N (FORK.md, SLRM-2393): `orca best-of`, over this machine's fork.bestOf.* RPC, the stock
// orchestration worker start, and each worktree's own host for the diff and the pick.
import { randomBytes } from 'node:crypto'
import type { CommandHandler, HandlerContext } from '../dispatch/dispatch'
import { getOptionalStringFlag, getRequiredStringFlag } from '../arguments/flags'
import { readTextOrFileFlag } from '../arguments/command-body-input'
import { printResult } from '../output/command-result-output'
import { RuntimeClient } from '../runtime/client'
import { RuntimeClientError } from '../runtime/connection/types'
import { isLocalEnvironmentSelector } from '../hosts/local-environment-selector'
import { callOrchestrationMutation } from '../orchestration/recovery/mutation-request'
import { resolveCoordinatorTerminalHandle } from '../orchestration/identity/terminal-identity'
import { isDevCliInvocation } from '../orchestration/recovery/runtime-compatibility'
import { forkResolveAutoPlacement } from './auto-placement-resolve'
import {
  isForkBestOfLoserAction,
  readForkBestOfSettings,
  type ForkBestOfRun
} from '../../shared/fork/best-of/best-of'
import {
  readForkBestOfDiff,
  settleForkBestOf,
  type ForkBestOfCall,
  type ForkBestOfDiffResult
} from '../../shared/fork/best-of/best-of-compare'
import type {
  ForkBestOfListResult,
  ForkBestOfRunResult,
  ForkBestOfShowResult
} from '../../shared/fork/best-of/best-of-wire'
import type { ForkSettingsGetResult } from '../../shared/fork/settings-wire'
import { startForkBestOf, type ForkBestOfWorkerReceipt } from './best-of-start'
import {
  formatForkBestOfList,
  formatForkBestOfShow,
  formatForkBestOfStarted
} from './best-of-format'

/** A worker start waits for its agent to be ready; an archive waits for its removal. */
const CALL_TIMEOUT_MS = 5 * 60_000

function incompatible(error: unknown): never {
  if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
    throw new RuntimeClientError(
      'incompatible_runtime',
      'This Orca has no best-of commands (Best of N is a Blackfish feature). Update the desktop app and try again.'
    )
  }
  throw error
}

/** A runtime error as it is; any other error (a refused input) as invalid_argument. */
function cliError(error: unknown): never {
  if (error instanceof RuntimeClientError) {
    throw error
  }
  throw new RuntimeClientError(
    'invalid_argument',
    error instanceof Error ? error.message : String(error)
  )
}

/** Runs are kept by this machine's Orca: refuse a client routed to a paired server. */
function localClient(ctx: HandlerContext): RuntimeClient {
  const selector = ctx.client.environmentSelector
  if (selector && !isLocalEnvironmentSelector(selector)) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Best-of runs are kept by this machine; run orca best-of without --environment (attempts can still go to paired servers with --on).'
    )
  }
  return ctx.client
}

/** Calls this machine's Orca (null) or a paired server, one client per server. */
function hostCall(local: RuntimeClient): ForkBestOfCall {
  const clients = new Map<string, RuntimeClient>()
  return async (environmentId, method, params) => {
    let client = local
    if (environmentId !== null) {
      client =
        clients.get(environmentId) ??
        new RuntimeClient(local.userDataPath, CALL_TIMEOUT_MS, null, environmentId)
      clients.set(environmentId, client)
    }
    return (await client.call<unknown>(method, params, { timeoutMs: CALL_TIMEOUT_MS })).result
  }
}

async function show(local: RuntimeClient, id: string) {
  return local.call<ForkBestOfShowResult>('fork.bestOf.show', { id }).catch(incompatible)
}

async function settings(local: RuntimeClient) {
  try {
    const reply = await local.call<ForkSettingsGetResult>('fork.settings.get', {})
    return readForkBestOfSettings(reply.result.values)
  } catch {
    // An older Blackfish without the settings RPC: the defaults.
    return readForkBestOfSettings(undefined)
  }
}

async function start(ctx: HandlerContext): Promise<void> {
  const local = localClient(ctx)
  const { flags, cwd } = ctx
  const count = Number(getRequiredStringFlag(flags, 'count'))
  const prompt = (await readTextOrFileFlag(flags, cwd, 'prompt', true)) ?? ''
  const from = await resolveCoordinatorTerminalHandle(flags, cwd, local)
  if (!from) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Run orca best-of from an Orca terminal or chat: each attempt is a worker started by it.'
    )
  }
  const run = await startForkBestOf(
    {
      count,
      prompt,
      agents: getOptionalStringFlag(flags, 'agents'),
      on: getOptionalStringFlag(flags, 'on'),
      repo: getOptionalStringFlag(flags, 'repo'),
      baseBranch: getOptionalStringFlag(flags, 'base-branch')
    },
    {
      settings: await settings(local),
      tag: randomBytes(3).toString('hex'),
      note: ctx.json ? undefined : (line) => process.stderr.write(`${line}\n`),
      placeAuto: async (repo) => {
        const placed = new Map<string, string | boolean>([
          ['on', 'auto'],
          ['worktree', 'new-top-level'],
          ['repo', repo]
        ])
        await forkResolveAutoPlacement(
          { commandPath: ['orchestration', 'worker-start'], flags: placed },
          () => local
        )
        const on = placed.get('on')
        return typeof on === 'string' && on !== 'auto' ? on : null
      },
      startWorker: async (params) => {
        const reply = await callOrchestrationMutation<ForkBestOfWorkerReceipt>(
          local,
          flags,
          'orchestration.workerStart',
          { ...params, worktree: 'new-top-level', from, devMode: isDevCliInvocation() },
          { timeoutMs: CALL_TIMEOUT_MS }
        )
        // A new workspace's worker stays open, as worker-start keeps it; best effort.
        await local
          .call('orchestration.workerRetain', { dispatch: reply.result.dispatchId })
          .catch(() => undefined)
        return reply.result
      },
      record: async (attempts) =>
        (
          await local
            .call<ForkBestOfRunResult>('fork.bestOf.record', {
              prompt,
              attempts,
              ...(getOptionalStringFlag(flags, 'repo')
                ? { repo: getOptionalStringFlag(flags, 'repo') }
                : {}),
              ...(getOptionalStringFlag(flags, 'base-branch')
                ? { baseBranch: getOptionalStringFlag(flags, 'base-branch') }
                : {})
            })
            .catch(incompatible)
        ).result.run
    }
  ).catch(cliError)
  printResult(
    { id: run.id, ok: true, result: run, _meta: { runtimeId: '' } },
    ctx.json,
    (value: ForkBestOfRun) => formatForkBestOfStarted(value)
  )
}

export const FORK_BEST_OF_HANDLERS: Record<string, CommandHandler> = {
  'best-of list': async (ctx) => {
    const reply = await localClient(ctx)
      .call<ForkBestOfListResult>('fork.bestOf.list', {})
      .catch(incompatible)
    printResult(reply, ctx.json, (result) => formatForkBestOfList(result.runs))
  },
  'best-of show': async (ctx) => {
    const local = localClient(ctx)
    const reply = await show(local, getRequiredStringFlag(ctx.flags, 'id'))
    const call = hostCall(local)
    const diffs = new Map<number, ForkBestOfDiffResult>()
    await Promise.all(
      reply.result.facts.map(async (facts) => {
        diffs.set(facts.index, await readForkBestOfDiff(call, facts, reply.result.run))
      })
    )
    const result = { ...reply.result, diffs: Object.fromEntries(diffs) }
    printResult({ ...reply, result }, ctx.json, (value) =>
      formatForkBestOfShow(value.run, value.facts, diffs)
    )
  },
  'best-of pick': async (ctx) => {
    const local = localClient(ctx)
    const attempt = Number(getRequiredStringFlag(ctx.flags, 'attempt'))
    const losers = getOptionalStringFlag(ctx.flags, 'losers')
    if (losers !== undefined && !isForkBestOfLoserAction(losers)) {
      throw new RuntimeClientError('invalid_argument', '--losers takes archive, remove or keep.')
    }
    const shown = (await show(local, getRequiredStringFlag(ctx.flags, 'id'))).result
    const loserAction = losers ?? (await settings(local)).loserAction
    const result = await settleForkBestOf({
      call: hostCall(local),
      shown,
      winner: attempt,
      loserAction
    }).catch(cliError)
    printResult(
      { id: shown.run.id, ok: true, result, _meta: { runtimeId: '' } },
      ctx.json,
      (value) =>
        value.outcomes
          .map(
            ({ index, outcome }) =>
              `#${index}: ${outcome.kind}${outcome.message ? ` (${outcome.message})` : ''}`
          )
          .join('\n')
    )
  },
  'best-of': start
}
