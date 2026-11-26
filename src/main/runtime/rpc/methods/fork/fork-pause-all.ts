// Pause all (BAD-685, FORK.md "Pause all"): `fork.pauseAll.status` reads the switch (this host's,
// and with `fleet` every paired server's); `fork.pauseAll.set` engages or releases it here and on
// every paired server, for `orca pause-all` and `orca resume-all`, the status bar and the phone.
// Changing it needs the host-admin permission, which the local user and a paired client that
// manages this host hold; a phone may only read it.
import { defineMethod } from '../../core'
import {
  ForkPauseAllSetParams,
  ForkPauseAllStatusParams,
  type ForkPauseAllResult
} from '../../../../../shared/fork/pause-all'
import { listEnvironments } from '../../../../../shared/remote-runtime/host-store/runtime-environment-store'
import { getCanonicalUserDataPath } from '../../../../persistence/loading-store/user-data-path'
import { boundedForkPairedCall } from '../../../../fork/paired-server-call/paired-server-call'
import {
  readPauseAllEverywhere,
  setPauseAllEverywhere,
  type ForkPauseAllFleetDeps
} from '../../../../fork/pause-all/pause-all-fleet'
import { readForkPauseAll, writeForkPauseAll } from '../../../../fork/pause-all/pause-all-state'
import { forkPauseAllHeldCounts } from '../../../../fork/pause-all/pause-all-held-counts'

type Runtime = {
  requireStore: () => { getSettings: () => unknown }
  callOrchestrationWorkerServer: (
    environmentId: string,
    method: string,
    params: unknown,
    timeoutMs: number
  ) => Promise<unknown>
}

function fleetDeps(runtime: Runtime, by: string): ForkPauseAllFleetDeps {
  return {
    readLocal: readForkPauseAll,
    setLocal: (engaged, note) => writeForkPauseAll(engaged, { by, note }),
    listEnvironments: () => listEnvironments(getCanonicalUserDataPath()),
    call: boundedForkPairedCall((environmentId, method, params, timeoutMs) =>
      runtime.callOrchestrationWorkerServer(environmentId, method, params, timeoutMs)
    )
  }
}

function pairedOn(runtime: Runtime): boolean {
  try {
    const settings = runtime.requireStore().getSettings() as { forkPauseAllPairedServers?: boolean }
    return settings?.forkPauseAllPairedServers !== false
  } catch {
    return true
  }
}

export const FORK_PAUSE_ALL_METHODS = [
  defineMethod({
    name: 'fork.pauseAll.status',
    permission: 'workspace',
    params: ForkPauseAllStatusParams,
    handler: async (params, ctx): Promise<ForkPauseAllResult> => {
      const result = await readPauseAllEverywhere(
        fleetDeps(ctx.runtime, 'cli'),
        params.fleet === true
      )
      // Unread mail is held only while the switch is on (BAD-818).
      const held = result.state.engaged ? forkPauseAllHeldCounts(ctx.runtime) : null
      return held ? { ...result, held } : result
    }
  }),
  defineMethod({
    name: 'fork.pauseAll.set',
    permission: 'host-admin',
    params: ForkPauseAllSetParams,
    handler: (params, ctx): Promise<ForkPauseAllResult> =>
      setPauseAllEverywhere(fleetDeps(ctx.runtime, params.relayed ? 'paired' : 'cli'), {
        engaged: params.engaged,
        note: params.note ?? null,
        // A relayed change never fans out again, so two hosts paired to each other cannot loop.
        localOnly: params.relayed === true || params.localOnly === true || !pairedOn(ctx.runtime)
      })
  })
] as const
