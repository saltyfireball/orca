// Endpoint failover (SLRM-2267, FORK.md): the one entry `src/main/index.ts` calls. It wires the
// supervisor to the desktop's saved servers, its shared control connections and the learned
// routes file, and starts its timer. A probe is its own short-lived authenticated socket, so it
// never disturbs the live connection; a move closes this desktop's connections to that server and
// opens its status owner again, which dials the new route.
import { listEnvironments } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import { getPreferredPairedRuntimeConnection } from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import { FORK_ENDPOINT_ADDRESSES_METHOD } from '../../../shared/fork/endpoint-failover'
import type { ForkGlobalSettings } from '../../../shared/fork/fork-global-settings'
import { getRuntimeEnvironmentRegistryRoot } from '../../ipc/runtime-environments/catalog/runtime-environment-registry-root'
import {
  closeRemoteRuntimeRequestConnection,
  getRemoteRuntimeSharedControlDiagnostics,
  getRuntimeEnvironmentStatusOwner,
  sendRemoteRuntimeSharedControlRequest
} from '../../ipc/runtime-environments/connections/runtime-environment-request-connections'
import { isRuntimeEnvironmentManuallyDisconnected } from '../../ipc/runtime-environments/connectivity/runtime-environment-manual-disconnect'
import {
  EndpointFailoverSupervisor,
  type FailoverConnectionState
} from './endpoint-failover-supervisor'
import { probeEndpointRoute } from './endpoint-failover-probe'
import { EndpointRoutesFile } from './endpoint-routes-file'

const LEARN_TIMEOUT_MS = 5_000
const RETAIN_EVERY_MS = 10 * 60_000

let supervisor: EndpointFailoverSupervisor | null = null

function connectionState(environmentId: string): FailoverConnectionState {
  if (isRuntimeEnvironmentManuallyDisconnected(environmentId)) {
    return 'idle'
  }
  const diagnostics = getRemoteRuntimeSharedControlDiagnostics(environmentId)
  if (!diagnostics) {
    return 'idle'
  }
  return diagnostics.state === 'ready' && diagnostics.unresponsiveSince === undefined
    ? 'ready'
    : 'down'
}

export function startForkEndpointFailover(
  readSettings: () => ForkGlobalSettings | null | undefined
): void {
  if (supervisor) {
    return
  }
  const userDataPath = getRuntimeEnvironmentRegistryRoot()
  const routes = new EndpointRoutesFile(userDataPath)
  let lastRetainAt = Number.NEGATIVE_INFINITY
  supervisor = new EndpointFailoverSupervisor({
    readSettings,
    listEnvironments: () => {
      const environments = listEnvironments(userDataPath)
      const now = Date.now()
      if (now - lastRetainAt >= RETAIN_EVERY_MS) {
        lastRetainAt = now
        routes.retain(new Set(environments.map((environment) => environment.id)))
      }
      return environments
    },
    connectionState,
    probe: probeEndpointRoute,
    learn: async (environmentId) => {
      const environment = listEnvironments(userDataPath).find((entry) => entry.id === environmentId)
      if (!environment) {
        return null
      }
      const response = await sendRemoteRuntimeSharedControlRequest(
        environmentId,
        getPreferredPairedRuntimeConnection(environment),
        FORK_ENDPOINT_ADDRESSES_METHOD,
        undefined,
        LEARN_TIMEOUT_MS
      )
      return response.ok ? response.result : null
    },
    reconnect: (environmentId) => {
      closeRemoteRuntimeRequestConnection(environmentId)
      if (!isRuntimeEnvironmentManuallyDisconnected(environmentId)) {
        getRuntimeEnvironmentStatusOwner(userDataPath, environmentId).activate()
      }
    },
    readRoutes: (environmentId, hostKey) => routes.read(environmentId, hostKey),
    writeRoutes: (environmentId, hostKey, learned) => routes.write(environmentId, hostKey, learned),
    now: () => Date.now(),
    log: (message) => console.warn(message)
  })
  supervisor.start()
}
