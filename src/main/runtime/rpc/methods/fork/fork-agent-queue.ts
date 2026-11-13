// SLRM-2098 (FORK.md "Agent launch queue"): the queue for the CLI and paired clients. Each host
// answers for its own launches.
import { defineMethod } from '../../core'
import {
  ForkAgentQueueListParams,
  ForkAgentQueueStatusParams,
  ForkAgentQueueTicketParams
} from '../../../../../shared/fork/agent-queue'
import {
  forkAgentQueueCancel,
  forkAgentQueueSnapshot,
  forkAgentQueueStartNow,
  forkAgentQueueStatus
} from '../../../../fork/agent-queue/agent-queue-service'

export const FORK_AGENT_QUEUE_METHODS = [
  defineMethod({
    name: 'fork.agentQueue.list',
    permission: 'workspace',
    params: ForkAgentQueueListParams,
    handler: async () => forkAgentQueueSnapshot()
  }),
  defineMethod({
    name: 'fork.agentQueue.status',
    permission: 'workspace',
    params: ForkAgentQueueStatusParams,
    handler: async (params) => forkAgentQueueStatus(params)
  }),
  defineMethod({
    name: 'fork.agentQueue.start',
    permission: 'workspace',
    params: ForkAgentQueueTicketParams,
    handler: async (params) => ({ started: forkAgentQueueStartNow(params.id) })
  }),
  defineMethod({
    name: 'fork.agentQueue.cancel',
    permission: 'workspace',
    params: ForkAgentQueueTicketParams,
    handler: async (params) => ({ cancelled: forkAgentQueueCancel(params.id) })
  })
] as const
