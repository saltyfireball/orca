// Server health (SLRM-2311, FORK.md): the state and last seen time of each paired server this
// host watches, and this host's own heartbeat state (never its address). Read-only; backs
// `orca servers health`, the Settings card and any paired client, such as the phone.
import { defineMethod } from '../../core'
import {
  FORK_SERVER_HEALTH_LIST_METHOD,
  ForkServerHealthListParams
} from '../../../../../shared/fork/server-health'
import { listForkServerHealth } from '../../../../fork/server-health/server-health-service'

export const FORK_SERVER_HEALTH_METHODS = [
  defineMethod({
    name: FORK_SERVER_HEALTH_LIST_METHOD,
    permission: 'workspace',
    params: ForkServerHealthListParams,
    handler: async () => listForkServerHealth()
  })
] as const
