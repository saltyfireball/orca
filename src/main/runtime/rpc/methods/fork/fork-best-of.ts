// Best of N (FORK.md, SLRM-2393): this machine's record of best-of runs behind `orca best-of` and
// the compare view. The attempts themselves are stock orchestration workers; these methods keep
// the run, answer each attempt's facts and record a pick. None of them starts, stops or removes
// anything: the CLI and the window do that over the stock methods of each worktree's host.
import { defineMethod, type RpcContext } from '../../core'
import { readForkBestOfSettings } from '../../../../../shared/fork/best-of/best-of'
import {
  ForkBestOfForgetParams,
  ForkBestOfListParams,
  ForkBestOfRecordParams,
  ForkBestOfSettleParams,
  ForkBestOfShowParams,
  type ForkBestOfListResult,
  type ForkBestOfRunResult,
  type ForkBestOfShowResult
} from '../../../../../shared/fork/best-of/best-of-wire'
import { forkBestOfStore } from '../../../../fork/best-of/best-of-store'
import { forkBestOfFacts } from '../../../../fork/best-of/best-of-facts'
import { forkUsageReport } from '../../../../fork/usage-ledger/usage-report-service'
import { getCanonicalUserDataPath } from '../../../../persistence/loading-store/user-data-path'

const store = () => forkBestOfStore(getCanonicalUserDataPath())

function settings(ctx: RpcContext) {
  return readForkBestOfSettings(ctx.runtime.requireStore().getSettings())
}

export const FORK_BEST_OF_METHODS = [
  defineMethod({
    name: 'fork.bestOf.record',
    permission: 'workspace',
    params: ForkBestOfRecordParams,
    handler: async (params, ctx): Promise<ForkBestOfRunResult> => {
      const current = settings(ctx)
      if (!current.enabled) {
        throw new Error('Best of N is off. Turn it on in Settings > Blackfish.')
      }
      return { run: await store().record(params, current.history) }
    }
  }),
  defineMethod({
    name: 'fork.bestOf.list',
    permission: 'workspace',
    params: ForkBestOfListParams,
    handler: async (): Promise<ForkBestOfListResult> => ({ runs: await store().list() })
  }),
  defineMethod({
    name: 'fork.bestOf.show',
    permission: 'workspace',
    params: ForkBestOfShowParams,
    handler: async (params, ctx): Promise<ForkBestOfShowResult> => {
      const run = await store().get(params.id)
      const db = ctx.runtime.getOrchestrationDb()
      const facts = forkBestOfFacts(run.attempts, {
        worker: (id) => db.getWorkerDispatch(id),
        federated: (id) => db.getFederatedDispatch(id),
        task: (id) => db.getTask(id),
        usageByWorkspace: () => forkUsageReport({ by: 'workspace' })
      })
      return { run, facts }
    }
  }),
  defineMethod({
    name: 'fork.bestOf.settle',
    permission: 'workspace',
    params: ForkBestOfSettleParams,
    handler: async (params): Promise<ForkBestOfRunResult> => ({
      run: await store().settle(params)
    })
  }),
  defineMethod({
    name: 'fork.bestOf.forget',
    permission: 'workspace',
    params: ForkBestOfForgetParams,
    handler: async (params): Promise<ForkBestOfRunResult> => ({
      run: await store().forget(params.id)
    })
  })
] as const
