// Endpoint failover (SLRM-2267, FORK.md): the probe. One short-lived authenticated socket to a
// candidate route, so it never disturbs the live connection.
import { ELECTRON_REMOTE_RUNTIME_CLIENT_CAPABILITIES } from '../../../shared/remote-runtime/protocol/electron-remote-runtime-client-capabilities'
import { pairedRuntimeConnectionFromOffer } from '../../../shared/remote-runtime/pairing/paired-runtime-connection'
import { RemoteRuntimeRequestConnection } from '../../../shared/remote-runtime/requests/remote-runtime-request-connection'

export async function probeEndpointRoute(
  route: {
    endpoint: string
    deviceToken: string
    publicKeyB64: string
    pairedDeviceId?: string
  },
  timeoutMs: number
): Promise<boolean> {
  const connection = new RemoteRuntimeRequestConnection(
    pairedRuntimeConnectionFromOffer(route),
    ELECTRON_REMOTE_RUNTIME_CLIENT_CAPABILITIES
  )
  try {
    // The reply only comes over a socket that finished the handshake against the pinned host key.
    const response = await connection.request('status.get', { probe: true }, timeoutMs)
    return response.ok
  } catch {
    return false
  } finally {
    connection.close()
  }
}
