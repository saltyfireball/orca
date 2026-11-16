// Auto placement (FORK.md, SLRM-2266): read this machine's load, ask each paired server for its
// own, and rank them. The RPC methods in fork-auto-placement.ts wire the real runtime in; tests
// pass fakes.
import os from 'node:os'
import { execFile } from 'node:child_process'
import { mapWithConcurrency } from '../../../shared/concurrency/map-with-concurrency'
import {
  FORK_PLACEMENT_LOCAL_KEY,
  forkPlacementAutoWhenUnnamed,
  forkPlacementFor,
  parseForkMachineLoad,
  pickForkPlacement,
  type ForkAutoPlacementSettings,
  type ForkMachineLoad,
  type ForkPlacementProbe
} from '../../../shared/fork/auto-placement'
import {
  FORK_PLACEMENT_PROBE_TIMEOUT_MS,
  type ForkPlacementLoadResult,
  type ForkPlacementPickResult
} from '../../../shared/fork/auto-placement-wire'

const PROBE_CONCURRENCY = 4
const RUNTIME_PREFIX = 'runtime:'

/** macOS counts only never-used pages as free; inactive and purgeable pages are free to take too. */
export function parseDarwinVmStat(text: string): number | null {
  const pageSize = /page size of (\d+) bytes/.exec(text)?.[1]
  if (!pageSize) {
    return null
  }
  let pages = 0
  let seen = false
  for (const label of ['free', 'inactive', 'speculative', 'purgeable']) {
    const match = new RegExp(`^Pages ${label}:\\s+(\\d+)\\.?$`, 'm').exec(text)
    if (match) {
      pages += Number(match[1])
      seen = true
    }
  }
  return seen ? pages * Number(pageSize) : null
}

function readDarwinFreeMemory(): Promise<number | null> {
  return new Promise((resolve) => {
    execFile('/usr/bin/vm_stat', [], { timeout: 1_000 }, (error, stdout) => {
      resolve(error ? null : parseDarwinVmStat(String(stdout)))
    })
  })
}

/** This machine's cores, one-minute load average and free memory. */
export async function readLocalMachineLoad(
  platform: NodeJS.Platform = process.platform
): Promise<ForkMachineLoad> {
  const totalMemoryBytes = os.totalmem()
  const darwinFree = platform === 'darwin' ? await readDarwinFreeMemory() : null
  return {
    cpuCount:
      typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length,
    loadAverage: os.loadavg()[0] ?? 0,
    freeMemoryBytes: Math.min(totalMemoryBytes, darwinFree ?? os.freemem()),
    totalMemoryBytes
  }
}

export type ForkPlacementDeps = {
  settings: () => ForkAutoPlacementSettings | null | undefined
  /** Paired servers saved on this machine. */
  listEnvironments: () =>
    | readonly { id: string; name: string }[]
    | Promise<readonly { id: string; name: string }[]>
  /** This machine's own fork.placement.load answer. */
  localLoad: (
    repo: string | undefined,
    project: string | undefined
  ) => Promise<ForkPlacementLoadResult>
  /** Calls a paired server's runtime; rejects with an error carrying `code` on failure. */
  callEnvironment: (
    environmentId: string,
    method: string,
    params: unknown,
    timeoutMs: number
  ) => Promise<unknown>
}

export type ForkPlacementRequest = {
  hosts?: readonly string[]
  repo?: string
  project?: string
  unnamed?: boolean
}

type ProbeStatus = ForkPlacementProbe['status']

/** Folds the repo and project answers into a status for a machine whose probe answered. */
function answeredStatus(
  request: ForkPlacementRequest,
  answer: unknown,
  knownReady: boolean
): ProbeStatus {
  const fields = typeof answer === 'object' && answer !== null ? answer : {}
  if (request.repo && 'repoFound' in fields && fields.repoFound === false) {
    return 'no-repo'
  }
  const projectReady = 'projectReady' in fields && fields.projectReady === true
  if (request.project && !knownReady && !projectReady) {
    return 'no-setup'
  }
  return 'ok'
}

const LOCAL_NAME = 'this machine'

function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : undefined
}

async function probeEnvironment(
  deps: ForkPlacementDeps,
  environmentId: string,
  request: ForkPlacementRequest,
  knownReady: boolean
): Promise<Pick<ForkPlacementProbe, 'load' | 'status'>> {
  try {
    const answer = await deps.callEnvironment(
      environmentId,
      'fork.placement.load',
      {
        ...(request.repo ? { repo: request.repo } : {}),
        ...(request.project && !knownReady ? { project: request.project } : {})
      },
      FORK_PLACEMENT_PROBE_TIMEOUT_MS
    )
    const load = parseForkMachineLoad((answer as { load?: unknown } | null)?.load)
    if (!load) {
      return { load: null, status: 'unreachable' }
    }
    return { load, status: answeredStatus(request, answer, knownReady) }
  } catch (error) {
    return {
      load: null,
      status: errorCode(error) === 'method_not_found' ? 'no-probe' : 'unreachable'
    }
  }
}

/**
 * Probes the requested machines (this one and every paired server by default) and ranks them.
 * With `project`, this machine and every paired server are considered on top of `hosts`, and a
 * machine qualifies only when it is in `hosts` (the caller already saw a ready setup for it) or
 * answers that the project has a ready setup there: project setups are kept per Orca, so the
 * caller's own list does not show what each paired server has set up for itself.
 */
export async function pickForkPlacementOnHosts(
  deps: ForkPlacementDeps,
  request: ForkPlacementRequest
): Promise<ForkPlacementPickResult> {
  const settings = deps.settings()
  if (request.unnamed && !forkPlacementAutoWhenUnnamed(settings)) {
    return { off: true }
  }
  const environments = await deps.listEnvironments()
  const byId = new Map(environments.map((environment) => [environment.id, environment]))
  const everyMachine = [
    FORK_PLACEMENT_LOCAL_KEY,
    ...environments.map((environment) => RUNTIME_PREFIX + environment.id)
  ]
  const keys = request.project
    ? [...new Set([...(request.hosts ?? []), ...everyMachine])]
    : request.hosts
      ? [...new Set(request.hosts)]
      : everyMachine
  const knownReady = new Set(request.project ? (request.hosts ?? []) : [])
  const probes = await mapWithConcurrency(keys, PROBE_CONCURRENCY, async (hostKey) => {
    const preference = forkPlacementFor(settings, hostKey)
    if (hostKey === FORK_PLACEMENT_LOCAL_KEY) {
      const name = LOCAL_NAME
      if (preference === 'manual') {
        return { hostKey, name, preference, load: null, status: 'ok' } satisfies ForkPlacementProbe
      }
      try {
        const ready = knownReady.has(hostKey)
        const answer = await deps.localLoad(request.repo, ready ? undefined : request.project)
        const status = answeredStatus(request, answer, ready)
        return { hostKey, name, preference, load: answer.load, status } satisfies ForkPlacementProbe
      } catch {
        return {
          hostKey,
          name,
          preference,
          load: null,
          status: 'unreachable'
        } satisfies ForkPlacementProbe
      }
    }
    const environmentId = hostKey.startsWith(RUNTIME_PREFIX)
      ? hostKey.slice(RUNTIME_PREFIX.length)
      : null
    const environment = environmentId ? byId.get(environmentId) : undefined
    if (!environment) {
      // SSH targets and machines this host does not know have no load probe.
      return {
        hostKey,
        name: hostKey,
        preference,
        load: null,
        status: 'no-probe'
      } satisfies ForkPlacementProbe
    }
    if (preference === 'manual') {
      return {
        hostKey,
        name: environment.name,
        preference,
        load: null,
        status: 'ok'
      } satisfies ForkPlacementProbe
    }
    const probed = await probeEnvironment(deps, environment.id, request, knownReady.has(hostKey))
    return { hostKey, name: environment.name, preference, ...probed } satisfies ForkPlacementProbe
  })
  return pickForkPlacement(probes)
}
