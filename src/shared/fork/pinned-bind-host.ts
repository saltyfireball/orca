// Blackfish (SLRM-2264): `orca serve --bind <ip>` pins the listener to one address. A pin to a
// real network address (a Tailscale or LAN IP) is already reachable, so pairing needs no widening.
const LOOPBACK_OR_WILDCARD = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0', '::'])

export function isPinnedToNetworkAddress(host: string | null | undefined): boolean {
  if (!host) {
    return false
  }
  const normalized = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
  if (!normalized || LOOPBACK_OR_WILDCARD.has(normalized)) {
    return false
  }
  return !normalized.startsWith('127.')
}
