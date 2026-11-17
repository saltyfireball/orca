// Server updates (FORK.md, SLRM-2310): the desktop's side wired to its runtime, and the start-up
// hook. At start-up every host settles an update its own restart finished (the server side), and a
// desktop with `forkServerUpdateAuto` on updates its paired servers once it runs a new version.
// Keep electron out of this file: orcad calls the start-up hook too.
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getAppEnvironment } from '../../../shared/app-lifecycle/app-environment'
import { listEnvironments } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import {
  isForkReleaseVersion,
  pickForkServerUpdateSettings,
  readForkServerUpdateConfig,
  type ForkServerUpdateSettings
} from '../../../shared/fork/server-update'
import { getCanonicalUserDataPath } from '../../persistence/loading-store/user-data-path'
import { settleForkServerUpdateAtStart } from './server-update-state'
import {
  createForkServersRunRegistry,
  type ForkServersDeps,
  type ForkServersRunRegistry
} from './servers-fleet'

export type ForkServersRuntime = {
  requireStore: () => { getSettings: () => unknown }
  callOrchestrationWorkerServer: (
    environmentId: string,
    method: string,
    params: unknown,
    timeoutMs: number
  ) => Promise<unknown>
}

const AUTO_RECORD_FILE = 'fork-server-update-desktop.json'

function settingsOf(runtime: ForkServersRuntime): ForkServerUpdateSettings | null {
  try {
    return pickForkServerUpdateSettings(runtime.requireStore().getSettings())
  } catch {
    return null
  }
}

export function forkServersDeps(runtime: ForkServersRuntime): ForkServersDeps {
  return {
    listEnvironments: async () => listEnvironments(getCanonicalUserDataPath()),
    call: (environmentId, method, params, timeoutMs) =>
      runtime.callOrchestrationWorkerServer(environmentId, method, params, timeoutMs),
    localVersion: () => getAppEnvironment().getVersion(),
    turnWaitMinutes: () => {
      const config = readForkServerUpdateConfig(settingsOf(runtime))
      return 'error' in config ? 30 : config.turnWaitMinutes
    },
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  }
}

let registry: ForkServersRunRegistry | null = null

export function liveForkServersRuns(runtime: ForkServersRuntime): ForkServersRunRegistry {
  registry ??= createForkServersRunRegistry(forkServersDeps(runtime), () =>
    randomUUID().slice(0, 8)
  )
  return registry
}

/** True once per new version: the version this desktop last started on is kept beside its data. */
export async function forkDesktopVersionChanged(
  userDataPath: string,
  version: string
): Promise<boolean> {
  const path = join(userDataPath, AUTO_RECORD_FILE)
  let last: unknown = null
  let seen = false
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    last =
      typeof parsed === 'object' && parsed !== null && 'version' in parsed ? parsed.version : null
    seen = true
  } catch {
    // First start with the feature: record the version, update nothing.
  }
  if (last === version) {
    return false
  }
  await writeFile(path, JSON.stringify({ version }), { mode: 0o600 })
  return seen
}

let started = false

export function startForkServerUpdate(runtime: ForkServersRuntime): void {
  if (started || process.env.VITEST) {
    return
  }
  started = true
  void runForkServerUpdateStart(runtime).catch((error: unknown) => {
    console.warn('[fork-server-update] the start-up pass failed:', error)
  })
}

async function runForkServerUpdateStart(runtime: ForkServersRuntime): Promise<void> {
  const userData = getCanonicalUserDataPath()
  const version = getAppEnvironment().getVersion()
  const settled = await settleForkServerUpdateAtStart(userData, version, Date.now())
  if (settled) {
    console.log(`[fork-server-update] ${settled.kind} ${settled.phase}: ${settled.message ?? ''}`)
  }
  const config = readForkServerUpdateConfig(settingsOf(runtime))
  if ('error' in config || !config.auto || !isForkReleaseVersion(version)) {
    return
  }
  if (!(await forkDesktopVersionChanged(userData, version))) {
    return
  }
  const run = await liveForkServersRuns(runtime).start({ kind: 'update', version }, version)
  console.log(`[fork-server-update] updating paired servers to ${version} (run ${run.runId})`)
}
