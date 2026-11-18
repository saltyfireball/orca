// Set up on a server (FORK.md, SLRM-2406) on the phone: typed calls for fork.serverSetup.*. Plan and
// readiness go to the server being set up (through the desktop's relay); run goes to the paired
// desktop, which clones and registers the project there over its own link, as the CLI's
// --setup-missing does.
import {
  FORK_SERVER_SETUP_READINESS_TIMEOUT_MS,
  FORK_SERVER_SETUP_RUN_TIMEOUT_MS,
  ForkServerSetupPlanSchema,
  ForkServerSetupReadinessSchema,
  ForkServerSetupRunResultSchema,
  type ForkServerSetupPlan,
  type ForkServerSetupRunResult
} from '../../../../../src/shared/fork/server-setup-wire'
import type { ForkServerSetupReadiness } from '../../../../../src/shared/fork/server-setup'
import { bindDeferredRpcOperation, defineRpcOperation } from '../../../transport/rpc/rpc-operation'
import { rpcResultVariant } from '../../../transport/rpc/rpc-operation-result-reader'
import type { RpcClient } from '../../../transport/rpc/rpc-client-contract'

const PLAN_TIMEOUT_MS = 15_000

export const forkServerSetupPlanRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'fork.server-setup.plan',
    method: 'fork.serverSetup.plan',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('fork-server-setup-plan', ForkServerSetupPlanSchema)
  })
)

export const forkServerSetupReadinessRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'fork.server-setup.readiness',
    method: 'fork.serverSetup.readiness',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('fork-server-setup-readiness', ForkServerSetupReadinessSchema)
  })
)

export const forkServerSetupRun = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'fork.server-setup.run',
    method: 'fork.serverSetup.run',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('fork-server-setup-run', ForkServerSetupRunResultSchema)
  })
)

/** Asks the server where the project would be cloned. */
export async function planMobileForkServerSetup(
  serverClient: RpcClient,
  params: { url: string; parent: string }
): Promise<ForkServerSetupPlan> {
  return forkServerSetupPlanRead.interpret(
    await forkServerSetupPlanRead.request(serverClient, params, { timeoutMs: PLAN_TIMEOUT_MS })
  )
}

/** Asks the paired desktop to clone and register the project on one of its servers. Readiness is
 *  left to the phone, so the sheet can show that stage. */
export async function runMobileForkServerSetup(
  desktopClient: RpcClient,
  params: { environmentId: string; project: string }
): Promise<ForkServerSetupRunResult> {
  return forkServerSetupRun.interpret(
    await forkServerSetupRun.request(
      desktopClient,
      { ...params, skipReadiness: true },
      { timeoutMs: FORK_SERVER_SETUP_RUN_TIMEOUT_MS }
    )
  )
}

/** Asks the server what the new checkout needs that it lacks. */
export async function readMobileForkServerSetupReadiness(
  serverClient: RpcClient,
  path: string
): Promise<ForkServerSetupReadiness> {
  return forkServerSetupReadinessRead.interpret(
    await forkServerSetupReadinessRead.request(
      serverClient,
      { path },
      { timeoutMs: FORK_SERVER_SETUP_READINESS_TIMEOUT_MS }
    )
  )
}
