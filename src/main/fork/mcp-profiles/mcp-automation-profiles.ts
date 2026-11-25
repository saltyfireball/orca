// FORK.md "Agent profiles" (BAD-800): the MCP profile an automation was created with
// (`automations create --profile`), kept by the automation's creation key in
// `<userData>/fork-mcp-profiles/automations.json` (0600). It is saved before the automation exists,
// so no run can start without it, and every run checks it again by name: a profile changed since
// applies as it is now, a deleted one refuses the run. Nothing here is set by default.
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { FORK_MCP_PROFILE_ALL, isForkMcpProfileName } from '../../../shared/fork/mcp-profiles'
import { InvalidArgumentError } from '../../runtime/rpc/core'
import {
  assertForkMcpProfileApplies,
  assertForkMcpProfileKnown,
  forkMcpProfileParamOf,
  runInForkMcpLaunchScope
} from './mcp-launch-scope'

const MAX_AUTOMATIONS = 2000
const MAX_KEY = 200
const KEY_PREFIX = 'fork-mcp:'

export class ForkMcpAutomationProfiles {
  private profiles = new Map<string, string>()
  private writes: Promise<void> = Promise.resolve()

  constructor(private readonly file: string | null) {}

  async load(): Promise<void> {
    if (!this.file) {
      return
    }
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file, 'utf8'))
      const raw = (parsed as { automations?: unknown })?.automations
      for (const [key, value] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
        if (key.length <= MAX_KEY && typeof value === 'string' && isForkMcpProfileName(value)) {
          this.profiles.set(key, value)
        }
      }
    } catch (error) {
      // An unreadable file loses no restriction: a run whose key has no entry is refused below.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[fork-mcp-profiles] could not read automation profiles', String(error))
      }
    }
  }

  get(creationKey: string | undefined): string | undefined {
    return creationKey ? this.profiles.get(creationKey) : undefined
  }

  /** Saved to disk before it resolves; rejects when the file cannot be written. */
  set(creationKey: string, profile: string | undefined): Promise<void> {
    if (profile === undefined) {
      this.profiles.delete(creationKey)
    } else {
      this.profiles.delete(creationKey)
      this.profiles.set(creationKey, profile)
      while (this.profiles.size > MAX_AUTOMATIONS) {
        this.profiles.delete(this.profiles.keys().next().value ?? '')
      }
    }
    const file = this.file
    if (!file) {
      return Promise.resolve()
    }
    const body = JSON.stringify({ version: 1, automations: Object.fromEntries(this.profiles) })
    const save = async (): Promise<void> => {
      await mkdir(dirname(file), { recursive: true, mode: 0o700 })
      const temp = `${file}.${randomUUID()}.tmp`
      await writeFile(temp, body, { mode: 0o600, flag: 'wx' })
      await rename(temp, file)
    }
    const run = this.writes.then(save, save)
    this.writes = run.catch(() => undefined)
    return run
  }
}

let installed: ForkMcpAutomationProfiles | null = null

/** Set by the MCP profiles service at install; null on a host without MCP profiles. */
export function setForkMcpAutomationProfiles(store: ForkMcpAutomationProfiles | null): void {
  installed = store
}

export function forkMcpAutomationProfiles(): ForkMcpAutomationProfiles | null {
  return installed
}

type AutomationCreateCall = {
  request: { method: string; params?: unknown }
  params?: unknown
}

/**
 * Dispatcher hook for `automation.create`: the MCP profile a `--profile` create names is checked
 * and saved under the automation's creation key before the automation is written. A bot
 * automation, another agent or a profile this host lacks is refused with nothing created.
 */
export async function withForkAutomationMcpProfile<T>(
  store: ForkMcpAutomationProfiles | null,
  call: AutomationCreateCall,
  run: () => T
): Promise<Awaited<T>> {
  const profile = forkMcpProfileParamOf(call.request.params)
  if (!profile || profile === FORK_MCP_PROFILE_ALL) {
    return await run()
  }
  const params = (call.params ?? {}) as { creationKey?: unknown; agentId?: unknown; bot?: unknown }
  const refused = `MCP profile "${profile}" cannot be stored on this automation: `
  if (params.bot) {
    throw new InvalidArgumentError(
      `${refused}a bot automation runs in the bot's own chat. Nothing was created.`
    )
  }
  assertForkMcpProfileKnown(profile, refused)
  assertForkMcpProfileApplies(profile, {
    agent: typeof params.agentId === 'string' ? params.agentId : undefined
  })
  if (!store) {
    throw new InvalidArgumentError(`${refused}MCP profiles are not loaded. Nothing was created.`)
  }
  if (typeof params.creationKey !== 'string' || params.creationKey === '') {
    // The key links the saved profile to the automation before the automation exists.
    params.creationKey = `${KEY_PREFIX}${randomUUID()}`
  }
  const key = params.creationKey as string
  await store.set(key, profile).catch((error: unknown) => {
    throw new InvalidArgumentError(
      `${refused}it could not be saved (${error instanceof Error ? error.message : String(error)}). Nothing was created.`
    )
  })
  try {
    return await run()
  } catch (error) {
    if (key.startsWith(KEY_PREFIX)) {
      await store.set(key, undefined).catch(() => undefined)
    }
    throw error
  }
}

type LaunchedAutomation = { name: string; agentId: string; creationKey?: string }

/**
 * The automation launchers' hook: a run of an automation that stored an MCP profile launches in
 * the background scope with that profile, checked by name as it is now. A deleted profile, another
 * agent or a host without MCP profiles refuses the run with the reason; it never runs wider.
 */
export function forkAutomationMcpLaunch<T>(
  automation: LaunchedAutomation,
  run: () => Promise<T>
): Promise<T> {
  const profile = installed?.get(automation.creationKey)
  if (!profile) {
    // The key was made for a stored profile; without the entry the run could load every server.
    return automation.creationKey?.startsWith(KEY_PREFIX)
      ? Promise.reject(
          new Error(
            `Automation "${automation.name}" did not run: the MCP profile it was created with is no longer saved on this computer, so Orca cannot tell which servers it may load. Create it again with --profile.`
          )
        )
      : run()
  }
  try {
    assertForkMcpProfileKnown(profile, `Automation "${automation.name}" did not run: `)
    assertForkMcpProfileApplies(profile, { agent: automation.agentId })
  } catch (error) {
    return Promise.reject(error)
  }
  return runInForkMcpLaunchScope({ kind: 'background', profile }, run)
}

/** The one-line hook form: a launcher whose runs go through `forkAutomationMcpLaunch`. */
export function forkMcpLaunched<R, Q extends { automation: LaunchedAutomation }, T>(
  launcher: (runtime: R, request: Q) => Promise<T>
): (runtime: R, request: Q) => Promise<T> {
  return (runtime, request) =>
    forkAutomationMcpLaunch(request.automation, () => launcher(runtime, request))
}
