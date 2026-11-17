// Server updates (FORK.md, SLRM-2310): the desktop side. Lists this desktop's paired servers with
// their versions, and updates (or rolls back) them one at a time over each server's own RPC, so no
// SSH is needed. One that fails or does not answer is reported and the rest go on.
import { compareForkVersions, isForkReleaseVersion } from '../../../shared/fork/server-update'
import type {
  ForkServerRow,
  ForkServersListResult,
  ForkServersRunResult,
  ForkServersRunRow,
  ForkServerUpdateStatus
} from '../../../shared/fork/server-update-wire'
import {
  isForkServerUpdateStartResult,
  isForkServerUpdateStatus
} from '../../../shared/fork/server-update-wire'

const STATUS_TIMEOUT_MS = 10_000
const START_TIMEOUT_MS = 30_000
const POLL_MS = 3_000
/** Download, check and restart, on top of the turn wait. */
const UPDATE_SLACK_MS = 20 * 60_000

export type ForkServersDeps = {
  listEnvironments: () => Promise<readonly { id: string; name: string }[]>
  call: (
    environmentId: string,
    method: string,
    params: unknown,
    timeoutMs: number
  ) => Promise<unknown>
  localVersion: () => string
  /** The desktop's own turn wait setting, used for the poll deadline when none is given. */
  turnWaitMinutes: () => number
  now: () => number
  sleep: (ms: number) => Promise<void>
}

function code(error: unknown): string | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 400)
}

async function readStatus(
  deps: ForkServersDeps,
  id: string
): Promise<ForkServerUpdateStatus | { error: 'unreachable' | 'no-support' }> {
  try {
    const reply = await deps.call(id, 'fork.serverUpdate.status', {}, STATUS_TIMEOUT_MS)
    return isForkServerUpdateStatus(reply) ? reply : { error: 'no-support' }
  } catch (error) {
    return { error: code(error) === 'method_not_found' ? 'no-support' : 'unreachable' }
  }
}

export async function listForkServers(deps: ForkServersDeps): Promise<ForkServersListResult> {
  const version = deps.localVersion()
  const servers: ForkServerRow[] = []
  for (const environment of await deps.listEnvironments()) {
    const status = await readStatus(deps, environment.id)
    servers.push(
      'error' in status
        ? {
            id: environment.id,
            name: environment.name,
            status: null,
            error: status.error,
            versus: null
          }
        : {
            id: environment.id,
            name: environment.name,
            status,
            versus: compareForkVersions(status.version, version)
          }
    )
  }
  return { version, servers }
}

/** Picks servers by name or id; every one when none is named. Unknown names are an error. */
export function pickForkServers(
  environments: readonly { id: string; name: string }[],
  wanted: readonly string[] | undefined
): { id: string; name: string }[] {
  if (!wanted || wanted.length === 0) {
    return [...environments]
  }
  return wanted.map((query) => {
    const found =
      environments.find((environment) => environment.id === query) ??
      environments.filter((environment) => environment.name === query)
    if (Array.isArray(found)) {
      if (found.length !== 1) {
        throw new Error(
          found.length === 0
            ? `no paired server is named "${query}" (orca servers list shows them)`
            : `more than one paired server is named "${query}"; use its id`
        )
      }
      return found[0]
    }
    return found
  })
}

export type ForkServersRunRequest =
  | {
      kind: 'update'
      version: string
      servers?: string[]
      allowDowngrade?: boolean
      now?: boolean
      waitMinutes?: number
    }
  | { kind: 'rollback'; servers: string[]; now?: boolean; waitMinutes?: number }

/** Polls one server until its job settles and it answers on the version the job asked for. */
async function follow(
  deps: ForkServersDeps,
  row: ForkServersRunRow,
  jobId: string,
  deadline: number,
  onChange: () => void
): Promise<void> {
  while (deps.now() < deadline) {
    await deps.sleep(POLL_MS)
    const status = await readStatus(deps, row.id)
    if ('error' in status) {
      row.message = 'restarting; waiting for it to answer'
      onChange()
      continue
    }
    const job = status.job
    row.version = status.version
    if (!job || job.id !== jobId) {
      continue
    }
    row.phase = job.phase
    row.message =
      job.phase === 'waiting' && job.busy ? `waiting for ${job.busy} running turns` : job.message
    if (job.phase === 'done') {
      row.outcome = row.version === job.targetVersion ? 'updated' : 'failed'
      return
    }
    if (job.phase === 'failed' || job.phase === 'rolled-back') {
      row.outcome = job.phase
      return
    }
    onChange()
  }
  row.outcome = 'failed'
  row.message = 'gave up waiting for it to finish; check it with orca servers list'
}

async function runOne(
  deps: ForkServersDeps,
  request: ForkServersRunRequest,
  row: ForkServersRunRow,
  onChange: () => void
): Promise<void> {
  const status = await readStatus(deps, row.id)
  if ('error' in status) {
    row.outcome = status.error === 'no-support' ? 'skipped' : 'failed'
    row.message =
      status.error === 'no-support'
        ? 'it runs an Orca without server updates; update it once by hand'
        : 'it did not answer'
    return
  }
  row.fromVersion = status.version
  row.version = status.version
  if (request.kind === 'update' && compareForkVersions(status.version, request.version) === 0) {
    row.outcome = 'current'
    return
  }
  row.outcome = 'running'
  onChange()
  let started: unknown
  try {
    started = await deps.call(
      row.id,
      request.kind === 'update' ? 'fork.serverUpdate.apply' : 'fork.serverUpdate.rollback',
      request.kind === 'update'
        ? {
            version: request.version,
            ...(request.allowDowngrade ? { allowDowngrade: true } : {}),
            ...(request.now ? { now: true } : {}),
            ...(request.waitMinutes !== undefined ? { waitMinutes: request.waitMinutes } : {})
          }
        : {
            ...(request.now ? { now: true } : {}),
            ...(request.waitMinutes !== undefined ? { waitMinutes: request.waitMinutes } : {})
          },
      START_TIMEOUT_MS
    )
  } catch (error) {
    row.outcome = 'failed'
    row.message = message(error)
    return
  }
  if (!isForkServerUpdateStartResult(started)) {
    row.outcome = 'failed'
    row.message = 'it gave an answer this desktop does not understand'
    return
  }
  if ('current' in started) {
    row.outcome = 'current'
    return
  }
  row.phase = started.job.phase
  const waitMs = (request.now ? 0 : (request.waitMinutes ?? deps.turnWaitMinutes())) * 60_000
  await follow(deps, row, started.job.id, deps.now() + waitMs + UPDATE_SLACK_MS, onChange)
}

/** Runs the request over its servers in order; `onChange` sees the rows after every step. */
export async function runForkServers(
  deps: ForkServersDeps,
  request: ForkServersRunRequest,
  onChange: (rows: ForkServersRunRow[]) => void = () => undefined
): Promise<ForkServersRunRow[]> {
  if (request.kind === 'update' && !isForkReleaseVersion(request.version)) {
    throw new Error(
      `${request.version} is not a release version; name one with --version (this desktop may be a local build)`
    )
  }
  const picked = pickForkServers(await deps.listEnvironments(), request.servers)
  const rows: ForkServersRunRow[] = picked.map((server) => ({
    id: server.id,
    name: server.name,
    outcome: 'pending'
  }))
  const changed = (): void => onChange(rows.map((row) => ({ ...row })))
  for (const row of rows) {
    try {
      await runOne(deps, request, row, changed)
    } catch (error) {
      row.outcome = 'failed'
      row.message = message(error)
    }
    changed()
  }
  return rows
}

export type ForkServersRunRegistry = {
  start: (request: ForkServersRunRequest, targetVersion: string) => Promise<ForkServersRunResult>
  get: (runId: string) => ForkServersRunResult | null
}

/** Runs kept in memory so the CLI and Settings can follow one; at most one runs at a time. */
export function createForkServersRunRegistry(
  deps: ForkServersDeps,
  newId: () => string
): ForkServersRunRegistry {
  const runs = new Map<string, ForkServersRunResult>()
  let active: string | null = null
  return {
    start: async (request, targetVersion) => {
      if (active && runs.get(active)?.done === false) {
        throw new Error('a server update is already running from this desktop')
      }
      // Validate the names before answering, so a typo is an error and not a failed run.
      const picked = pickForkServers(await deps.listEnvironments(), request.servers)
      const runId = newId()
      const result: ForkServersRunResult = {
        runId,
        targetVersion,
        done: false,
        rows: picked.map((server) => ({ id: server.id, name: server.name, outcome: 'pending' }))
      }
      runs.set(runId, result)
      active = runId
      void runForkServers(deps, request, (rows) => {
        result.rows = rows
      })
        .then((rows) => {
          result.rows = rows
        })
        .catch((error: unknown) => {
          result.rows = result.rows.map((row) =>
            row.outcome === 'pending' ? { ...row, outcome: 'failed', message: message(error) } : row
          )
        })
        .finally(() => {
          result.done = true
        })
      return { ...result }
    },
    get: (runId) => {
      const result = runs.get(runId)
      return result ? { ...result, rows: result.rows.map((row) => ({ ...row })) } : null
    }
  }
}
