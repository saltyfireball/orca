// Batch start (FORK.md, SLRM-2395): fork.batchStart.start turns one prompt into a worktree plus
// agent per model, on the machine auto placement picks or on this one. Each task starts through
// agent.launch on this host (the same admission and launch queue as any launch), or the batch is
// forwarded to the picked paired server, which answers for its own machine.
import { randomBytes } from 'node:crypto'
import { hostname } from 'node:os'
import { defineMethod, type RpcContext } from '../../core'
import { AgentLaunch } from '../../../../../shared/rpc-contract/agent-launch/agent-launch-params'
import {
  FORK_BATCH_START_TIMEOUT_MS,
  ForkBatchStartParams,
  ForkBatchStartResultSchema,
  forkBatchLocalSetupRepo,
  forkBatchReadySetupHosts,
  type ForkBatchStartResult
} from '../../../../../shared/fork/batch-start'
import { pickForkPlacementOnHosts } from '../../../../fork/auto-placement/auto-placement-probe'
import { forkAgentQueueStatus } from '../../../../fork/agent-queue/agent-queue-service'
import {
  runForkBatchStart,
  type ForkBatchStartDeps
} from '../../../../fork/batch-start/batch-start-run'
import { launchAgentOnHost } from '../agent-launch/agent-launch'
import { agentLaunchFeatureRequirement } from '../../startup/agent-launch-feature-requirement'
import { forkPlacementDeps } from './fork-auto-placement'

/** A new chat's first start reaches the queue gate just after its launch returns. */
const QUEUE_STATUS_WAIT_MS = 1_500

function setups(
  ctx: RpcContext
): ReturnType<RpcContext['runtime']['listVisibleProjectHostSetups']> {
  try {
    return ctx.runtime.listVisibleProjectHostSetups()
  } catch {
    // A host that cannot list its setups has none to offer.
    return []
  }
}

function shortHostname(): string {
  return hostname().split('.')[0] || 'this machine'
}

function batchStartDeps(ctx: RpcContext): ForkBatchStartDeps {
  return {
    pick: (hosts, project) => pickForkPlacementOnHosts(forkPlacementDeps(ctx), { hosts, project }),
    readySetupHosts: (projectId) => forkBatchReadySetupHosts(setups(ctx), projectId),
    localRepo: (project) =>
      forkBatchLocalSetupRepo(ctx.runtime.listProjects(), setups(ctx), project),
    localLabel: shortHostname,
    // Parsed by agent.launch's own schema, then run with this caller's context and authority.
    launch: (request) => launchAgentOnHost(AgentLaunch.parse(request), ctx),
    queuePosition: async (sessionId) => {
      const status = await forkAgentQueueStatus({ sessionId, waitMs: QUEUE_STATUS_WAIT_MS })
      return status.state === 'queued' ? status.entry.position : null
    },
    forward: async (environmentId, request) =>
      ForkBatchStartResultSchema.parse(
        await ctx.runtime.callOrchestrationWorkerServer(
          environmentId,
          'fork.batchStart.start',
          request,
          FORK_BATCH_START_TIMEOUT_MS
        )
      ),
    randomTail: () => randomBytes(2).toString('hex')
  }
}

export const FORK_BATCH_START_METHODS = [
  defineMethod({
    name: 'fork.batchStart.start',
    // Same gate as agent.launch (every task starts an agent there, never reusing a terminal).
    requires: () => agentLaunchFeatureRequirement({}),
    permission: 'workspace',
    params: ForkBatchStartParams,
    handler: async (params, ctx): Promise<ForkBatchStartResult> =>
      runForkBatchStart(batchStartDeps(ctx), params)
  })
] as const
