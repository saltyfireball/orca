// Endpoint failover (SLRM-2267, FORK.md): the route the main process's supervisor picked for a
// saved server, when it picked another than the saved one. `getPreferredPairedRuntimeConnection`
// asks here, so every new socket to that server dials the picked route. Kept free of any import
// so the upstream file that reads it gains no dependency.

export type ForkEndpointRoute = {
  endpoint: string
  deviceToken: string
  publicKeyB64: string
}

type SavedEndpoint = ForkEndpointRoute & { id: string }

const activeRoutes = new Map<string, ForkEndpointRoute>()

/** A re-pair changes the token, so a route picked for the old pairing is never used for the new. */
function savedEndpointKey(saved: SavedEndpoint): string {
  return [saved.id, saved.deviceToken, saved.publicKeyB64].join('\0')
}

/** Picks `route` for the saved endpoint; null (or the saved route itself) goes back to the saved one. */
export function setForkActiveEndpointRoute(
  saved: SavedEndpoint,
  route: ForkEndpointRoute | null
): void {
  const key = savedEndpointKey(saved)
  if (!route || (route.endpoint === saved.endpoint && route.deviceToken === saved.deviceToken)) {
    activeRoutes.delete(key)
    return
  }
  activeRoutes.set(key, { ...route })
}

/** The route new sockets to this saved endpoint dial: the picked one, else the saved one. */
export function forkActiveEndpointRoute(saved: SavedEndpoint): ForkEndpointRoute {
  const route = activeRoutes.get(savedEndpointKey(saved))
  // Only a route to the same server (the same host key) is ever used in place of the saved one.
  if (route && route.publicKeyB64 === saved.publicKeyB64) {
    return route
  }
  return {
    endpoint: saved.endpoint,
    deviceToken: saved.deviceToken,
    publicKeyB64: saved.publicKeyB64
  }
}

/** Whether another route than the saved one is in use for this saved endpoint. */
export function hasForkActiveEndpointRoute(saved: SavedEndpoint): boolean {
  return activeRoutes.has(savedEndpointKey(saved))
}

/** Forgets every picked route; tests, and the switch going off. */
export function clearForkActiveEndpointRoutes(): void {
  activeRoutes.clear()
}
