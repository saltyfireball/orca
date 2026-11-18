// Branch clashes (FORK.md, SLRM-2394): the last check, shared by the desktop's timer and window
// and by `orca clashes`. One check runs at a time; a caller that arrives during one waits for it.
// No Electron here, so the RPC methods can import it on the headless server too.
import { listEnvironments } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import {
  readForkBranchClashConfig,
  type ForkClashResult
} from '../../../shared/fork/branch-clashes'
import type { RuntimeStore } from '../../runtime/construction/runtime-store-contract'
import { getCanonicalUserDataPath } from '../../persistence/loading-store/user-data-path'
import { gatherForkClashes, type ForkClashFleetDeps } from './branch-clashes-fleet'
import { scanForkClashesHere } from './branch-clashes-host'

export type ForkClashRuntime = {
  requireStore: () => RuntimeStore
  callOrchestrationWorkerServer: (
    environmentId: string,
    method: string,
    params: unknown,
    timeoutMs: number
  ) => Promise<unknown>
}

export function forkClashFleetDeps(runtime: ForkClashRuntime): ForkClashFleetDeps {
  return {
    config: () => readForkBranchClashConfig(runtime.requireStore().getSettings()),
    localReport: (project) => scanForkClashesHere(runtime.requireStore(), project),
    listEnvironments: () => listEnvironments(getCanonicalUserDataPath()),
    callEnvironment: (environmentId, method, params, timeoutMs) =>
      runtime.callOrchestrationWorkerServer(environmentId, method, params, timeoutMs),
    now: Date.now
  }
}

let latest: ForkClashResult | null = null
let running: Promise<ForkClashResult> | null = null
const listeners = new Set<(result: ForkClashResult | null) => void>()

export function forkClashesLatest(): ForkClashResult | null {
  return latest
}

export function onForkClashesChanged(
  listener: (result: ForkClashResult | null) => void
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function publish(next: ForkClashResult | null): void {
  latest = next
  for (const listener of listeners) {
    listener(next)
  }
}

/** Clears the last check, as when the warning is switched off. */
export function clearForkClashes(): void {
  if (latest !== null) {
    publish(null)
  }
}

/** Runs one full check (every project) and keeps it, or joins the one already running. */
export function runForkClashCheck(deps: ForkClashFleetDeps): Promise<ForkClashResult> {
  running ??= gatherForkClashes(deps, undefined)
    .then((result) => {
      publish(result)
      return result
    })
    .finally(() => {
      running = null
    })
  return running
}

/** Test hook. */
export function resetForkClashesForTest(): void {
  latest = null
  running = null
  listeners.clear()
}
