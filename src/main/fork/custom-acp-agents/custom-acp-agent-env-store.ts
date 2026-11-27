// FORK.md "Custom ACP agents": the values of each custom agent's environment variables. They never
// go in settings (which sync, export and show in Settings), only in one file this host's user alone
// can read, and from there only into the agent's own process environment: never a log or argv.
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

type EnvFile = { version: 1; agents: Record<string, Record<string, string>> }

let folder: string | null = null
let values: Map<string, Readonly<Record<string, string>>> | null = null
let writes: Promise<void> = Promise.resolve()

function stringRecord(value: unknown): Record<string, string> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string'
  )
  return Object.fromEntries(entries)
}

function parseEnvFile(text: string): Map<string, Readonly<Record<string, string>>> {
  const parsed: unknown = JSON.parse(text)
  const agents =
    typeof parsed === 'object' && parsed !== null && 'agents' in parsed ? parsed.agents : null
  const map = new Map<string, Readonly<Record<string, string>>>()
  if (typeof agents !== 'object' || agents === null) {
    return map
  }
  for (const [name, env] of Object.entries(agents)) {
    const record = stringRecord(env)
    if (record) {
      map.set(name, record)
    }
  }
  return map
}

/** Reads the store once at host start; a missing file is an empty store, an unreadable one too
 *  (its agents then start without their values, and list shows them missing). */
export async function loadForkCustomAcpEnvStore(dataFolder: string): Promise<void> {
  folder = dataFolder
  try {
    values = parseEnvFile(await readFile(join(dataFolder, 'env.json'), 'utf8'))
  } catch (error) {
    const missing =
      typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
    if (!missing) {
      console.warn('[fork-custom-acp-agents] the env store could not be read; values start empty')
    }
    values = new Map()
  }
}

export function forkCustomAcpEnvStoreLoaded(): boolean {
  return values !== null
}

/** The saved values of `name`'s variables; empty when none are saved. */
export function forkCustomAcpAgentEnvValues(name: string): Readonly<Record<string, string>> {
  return values?.get(name) ?? {}
}

async function writeStore(dataFolder: string, snapshot: EnvFile): Promise<void> {
  await mkdir(dataFolder, { recursive: true, mode: 0o700 })
  await chmod(dataFolder, 0o700).catch(() => undefined)
  const target = join(dataFolder, 'env.json')
  const temp = join(dataFolder, `.env-${randomUUID()}.json`)
  await writeFile(temp, `${JSON.stringify(snapshot)}\n`, { mode: 0o600 })
  await chmod(temp, 0o600).catch(() => undefined)
  await rename(temp, target)
}

/** Replaces `name`'s saved values (null removes them) and writes the store; writes run one at a
 *  time so the file always holds the last change. */
export function saveForkCustomAcpAgentEnv(
  name: string,
  env: Readonly<Record<string, string>> | null
): Promise<void> {
  if (!values || !folder) {
    return Promise.reject(new Error('Custom agents are not loaded on this host yet; try again.'))
  }
  if (env && Object.keys(env).length > 0) {
    values.set(name, { ...env })
  } else {
    values.delete(name)
  }
  const snapshot: EnvFile = { version: 1, agents: Object.fromEntries(values) }
  const dataFolder = folder
  writes = writes.catch(() => undefined).then(() => writeStore(dataFolder, snapshot))
  return writes
}

/** Test seam: forgets the loaded store. */
export function resetForkCustomAcpEnvStoreForTests(): void {
  folder = null
  values = null
  writes = Promise.resolve()
}
