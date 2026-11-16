// Endpoint failover (SLRM-2267, FORK.md): a saved remote server can be reached on more than one
// route (its LAN address, its Tailscale address, the address it was paired on). The desktop tries
// them in order, uses the first that answers, and while it runs on a worse route it retries the
// better ones and moves back. A Blackfish server reports its own LAN and Tailscale addresses, so
// the routes stay current when its address changes. Idea from T3 Code (MIT), its connection
// driver and supervisor; this is a fresh port, not their code.
import { z } from 'zod'
import {
  classifyRemotePairingHostname,
  type RemotePairingEndpointKind
} from '../remote-runtime/pairing/remote-pairing-address'
import type { ForkGlobalSettings } from './fork-global-settings'

export const FORK_ENDPOINT_FAILOVER_DEFAULT_RETRY_SECONDS = 60
const MIN_RETRY_SECONDS = 15
const MAX_RETRY_SECONDS = 3600
/** At most this many learned addresses are kept per server. */
export const FORK_ENDPOINT_MAX_LEARNED = 8

type EndpointFailoverSettings = Pick<
  ForkGlobalSettings,
  | 'forkEndpointFailover'
  | 'forkEndpointFailoverRetrySeconds'
  | 'forkEndpointLearnAddresses'
  | 'forkEndpointLearnSameSubnetOnly'
>

/** Unset is on; only an explicit false turns it off. */
export function forkEndpointFailoverEnabled(
  settings: EndpointFailoverSettings | null | undefined
): boolean {
  return settings?.forkEndpointFailover !== false
}

/** Unset is on; only an explicit false turns it off. */
export function forkEndpointLearnAddresses(
  settings: EndpointFailoverSettings | null | undefined
): boolean {
  return settings?.forkEndpointLearnAddresses !== false
}

/** Unset is on; only an explicit false lets a learned address outside the saved subnets be probed. */
export function forkEndpointLearnSameSubnetOnly(
  settings: EndpointFailoverSettings | null | undefined
): boolean {
  return settings?.forkEndpointLearnSameSubnetOnly !== false
}

/** Whole seconds from 15 to an hour; anything else reads as the default 60. */
export function forkEndpointFailoverRetrySeconds(
  settings: EndpointFailoverSettings | null | undefined
): number {
  const seconds = settings?.forkEndpointFailoverRetrySeconds
  return typeof seconds === 'number' &&
    Number.isInteger(seconds) &&
    seconds >= MIN_RETRY_SECONDS &&
    seconds <= MAX_RETRY_SECONDS
    ? seconds
    : FORK_ENDPOINT_FAILOVER_DEFAULT_RETRY_SECONDS
}

export const FORK_ENDPOINT_RETRY_SECOND_CHOICES: readonly number[] = [15, 30, 60, 120, 300, 600]

// ---- The server's report of its own addresses -------------------------------------------------

export const FORK_ENDPOINT_ADDRESSES_METHOD = 'fork.endpoints.addresses'

export const ForkEndpointAddressesParams = z.preprocess(
  (params) =>
    typeof params === 'object' && params !== null && !Array.isArray(params) ? params : {},
  z.object({})
)

export type ForkLearnedAddressKind = 'lan' | 'tailscale'

export type ForkLearnedAddress = { address: string; kind: ForkLearnedAddressKind }

export type ForkEndpointAddressesResult = { addresses: ForkLearnedAddress[] }

/** IPv4 LAN and Tailscale addresses only, deduplicated and capped; anything else is dropped. */
export function normalizeForkLearnedAddresses(value: unknown): ForkLearnedAddress[] {
  const list =
    typeof value === 'object' && value !== null && 'addresses' in value ? value.addresses : value
  if (!Array.isArray(list)) {
    return []
  }
  const seen = new Set<string>()
  const result: ForkLearnedAddress[] = []
  for (const entry of list) {
    const address =
      typeof entry === 'object' && entry !== null && 'address' in entry ? entry.address : entry
    if (typeof address !== 'string' || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) {
      continue
    }
    const kind = classifyRemotePairingHostname(address)
    if ((kind !== 'lan' && kind !== 'tailscale') || seen.has(address)) {
      continue
    }
    seen.add(address)
    result.push({ address, kind })
    if (result.length >= FORK_ENDPOINT_MAX_LEARNED) {
      break
    }
  }
  return result
}

function ipv4Parts(host: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!match) {
    return null
  }
  const parts = match.slice(1).map(Number)
  return parts.every((part) => part <= 255) ? parts : null
}

function isTailscaleIpv4(parts: number[]): boolean {
  // 100.64.0.0/10
  return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127
}

/**
 * A compromised paired server could report addresses that make this desktop probe other hosts on
 * its network. With the setting on, a learned address stays only when it shares the /24 of a saved
 * endpoint's IPv4 host or is a Tailscale (100.64.0.0/10) address.
 */
export function filterForkLearnedAddresses(
  learned: readonly ForkLearnedAddress[],
  savedEndpoints: readonly string[],
  sameSubnetOnly: boolean
): ForkLearnedAddress[] {
  if (!sameSubnetOnly) {
    return [...learned]
  }
  const subnets: number[][] = []
  for (const endpoint of savedEndpoints) {
    try {
      const parts = ipv4Parts(new URL(endpoint).hostname)
      if (parts) {
        subnets.push(parts)
      }
    } catch {
      // An unparsable saved endpoint names no subnet.
    }
  }
  return learned.filter((entry) => {
    const parts = ipv4Parts(entry.address)
    if (!parts) {
      return false
    }
    return (
      isTailscaleIpv4(parts) ||
      subnets.some(
        (subnet) => subnet[0] === parts[0] && subnet[1] === parts[1] && subnet[2] === parts[2]
      )
    )
  })
}

// ---- Routes -----------------------------------------------------------------------------------

type SavedEndpoint = {
  id: string
  endpoint: string
  deviceToken: string
  publicKeyB64: string
}

export type ForkEndpointCandidate = {
  endpoint: string
  deviceToken: string
  publicKeyB64: string
  kind: RemotePairingEndpointKind
  /** From the server's report rather than the saved pairing. */
  learned: boolean
}

/** Lower is tried first: LAN, then Tailscale, then any other address, then loopback. */
const KIND_RANK: Record<RemotePairingEndpointKind, number> = {
  lan: 0,
  tailscale: 1,
  public: 2,
  custom: 2,
  loopback: 3
}

function endpointKind(endpoint: string): RemotePairingEndpointKind | null {
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
      return null
    }
    return classifyRemotePairingHostname(url.hostname)
  } catch {
    return null
  }
}

/** The saved URL with its host swapped for a learned address; only for a plain ws: URL. */
export function learnedRouteUrl(savedEndpoint: string, address: string): string | null {
  try {
    const url = new URL(savedEndpoint)
    // A wss: certificate names its host; an IP in its place would fail the check anyway.
    if (url.protocol !== 'ws:') {
      return null
    }
    url.hostname = address
    return url.toString()
  } catch {
    return null
  }
}

/**
 * Every route to the server, best first. `preferred` is the saved preferred endpoint; the other
 * saved endpoints count only when they carry the same host key. Learned addresses reuse the
 * preferred endpoint's pairing, since they reach the same server on another address.
 */
export function buildForkEndpointCandidates(
  preferred: SavedEndpoint,
  others: readonly SavedEndpoint[],
  learned: readonly ForkLearnedAddress[]
): ForkEndpointCandidate[] {
  const result: ForkEndpointCandidate[] = []
  const seen = new Set<string>()
  const add = (endpoint: SavedEndpoint, isLearned: boolean): void => {
    const kind = endpointKind(endpoint.endpoint)
    if (kind === null || seen.has(endpoint.endpoint)) {
      return
    }
    seen.add(endpoint.endpoint)
    result.push({
      endpoint: endpoint.endpoint,
      deviceToken: endpoint.deviceToken,
      publicKeyB64: endpoint.publicKeyB64,
      kind,
      learned: isLearned
    })
  }
  add(preferred, false)
  for (const other of others) {
    if (other.publicKeyB64 === preferred.publicKeyB64) {
      add(other, false)
    }
  }
  // A saved loopback route is an SSH tunnel's or this machine's; its port means nothing elsewhere.
  if (endpointKind(preferred.endpoint) !== 'loopback') {
    for (const entry of learned) {
      const url = learnedRouteUrl(preferred.endpoint, entry.address)
      if (url) {
        add({ ...preferred, endpoint: url }, true)
      }
    }
  }
  // Stable sort: within one kind the saved routes keep their order ahead of learned ones.
  return result
    .map((candidate, index) => ({ candidate, index }))
    .sort(
      (a, b) =>
        KIND_RANK[a.candidate.kind] - KIND_RANK[b.candidate.kind] ||
        Number(a.candidate.learned) - Number(b.candidate.learned) ||
        a.index - b.index
    )
    .map(({ candidate }) => candidate)
}
