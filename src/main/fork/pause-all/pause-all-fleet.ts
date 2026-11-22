// Pause all (BAD-685, FORK.md "Pause all"): sets this host's switch and asks every paired server
// to set its own, at once, each with a deadline. A server that does not answer is reported, never
// waited on, and never stops the others. Pure over its deps, so it is tested with fake calls.
import { mapWithConcurrency } from '../../../shared/concurrency/map-with-concurrency'
import {
  FORK_PAUSE_ALL_SERVER_TIMEOUT_MS,
  FORK_PAUSE_ALL_SET_METHOD,
  FORK_PAUSE_ALL_STATUS_METHOD,
  parsePauseAllAnswer,
  type ForkPauseAllHostResult,
  type ForkPauseAllResult,
  type ForkPauseAllState
} from '../../../shared/fork/pause-all'

const SERVER_CONCURRENCY = 4

export type ForkPauseAllFleetDeps = {
  readLocal: () => ForkPauseAllState
  setLocal: (engaged: boolean, note: string | null) => ForkPauseAllState
  listEnvironments: () =>
    | readonly { id: string; name: string }[]
    | Promise<readonly { id: string; name: string }[]>
  call: (
    environmentId: string,
    method: string,
    params: unknown,
    timeoutMs: number
  ) => Promise<unknown>
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? typeof error.code === 'string'
      ? error.code
      : undefined
    : undefined
}

async function askServer(
  deps: ForkPauseAllFleetDeps,
  environment: { id: string; name: string },
  method: string,
  params: unknown
): Promise<ForkPauseAllHostResult> {
  try {
    const engaged = parsePauseAllAnswer(
      await deps.call(environment.id, method, params, FORK_PAUSE_ALL_SERVER_TIMEOUT_MS)
    )
    return engaged === null
      ? { name: environment.name, status: 'refused', detail: 'unexpected answer' }
      : { name: environment.name, status: 'applied', engaged }
  } catch (error) {
    const code = errorCode(error)
    if (code === 'method_not_found') {
      return {
        name: environment.name,
        status: 'refused',
        detail: 'this server has no pause-all; update it'
      }
    }
    if (code === 'forbidden' || code === 'permission_denied') {
      return { name: environment.name, status: 'refused', detail: 'not allowed to change it' }
    }
    return { name: environment.name, status: 'unreachable' }
  }
}

async function fleet(
  deps: ForkPauseAllFleetDeps,
  method: string,
  params: unknown
): Promise<ForkPauseAllHostResult[]> {
  const environments = await Promise.resolve(deps.listEnvironments()).catch(() => [])
  return mapWithConcurrency(environments, SERVER_CONCURRENCY, (environment) =>
    askServer(deps, environment, method, params)
  )
}

/** Sets this host's switch, then every paired server's unless `localOnly`. This host is set first, so a slow server never delays it. */
export async function setPauseAllEverywhere(
  deps: ForkPauseAllFleetDeps,
  input: { engaged: boolean; note: string | null; localOnly: boolean }
): Promise<ForkPauseAllResult> {
  const state = deps.setLocal(input.engaged, input.note)
  if (input.localOnly) {
    return { state, hosts: [] }
  }
  const hosts = await fleet(deps, FORK_PAUSE_ALL_SET_METHOD, {
    engaged: input.engaged,
    relayed: true,
    ...(input.note ? { note: input.note } : {})
  })
  return { state, hosts }
}

/** This host's switch, with every paired server's when `fleetToo`. */
export async function readPauseAllEverywhere(
  deps: ForkPauseAllFleetDeps,
  fleetToo: boolean
): Promise<ForkPauseAllResult> {
  const state = deps.readLocal()
  return {
    state,
    hosts: fleetToo ? await fleet(deps, FORK_PAUSE_ALL_STATUS_METHOD, { fleet: false }) : []
  }
}
