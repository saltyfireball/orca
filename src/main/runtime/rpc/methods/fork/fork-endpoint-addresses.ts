// Endpoint failover (SLRM-2267, FORK.md): a paired desktop asks this server for its current LAN
// and Tailscale addresses, so it can reach the server on another route when the one it uses
// stops answering. Only IPv4 addresses of those two kinds are reported; the desktop keeps its own
// port and scheme. Read-only, no files touched.
import { defineMethod } from '../../core'
import {
  ForkEndpointAddressesParams,
  normalizeForkLearnedAddresses,
  type ForkEndpointAddressesResult
} from '../../../../../shared/fork/endpoint-failover'
import { getPairingNetworkInterfaces } from '../../server/pairing/network/pairing-network-interfaces'

/** No Windows default-route lookup: only the address list matters here, not its ranking. */
const noDefaultRouteLookup = async (): Promise<ReadonlySet<string>> => new Set<string>()

export async function readForkEndpointAddresses(): Promise<ForkEndpointAddressesResult> {
  const interfaces = await getPairingNetworkInterfaces('0.0.0.0', noDefaultRouteLookup)
  return {
    addresses: normalizeForkLearnedAddresses(interfaces.map((entry) => entry.address))
  }
}

export const FORK_ENDPOINT_ADDRESSES_METHODS = [
  defineMethod({
    name: 'fork.endpoints.addresses',
    permission: 'workspace',
    params: ForkEndpointAddressesParams,
    handler: async () => readForkEndpointAddresses()
  })
] as const
