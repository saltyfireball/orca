// Set up on a server (FORK.md, SLRM-2312): `worktree create --project <p> --setup-missing` with
// `--host auto` (or a named paired server) sets the project up on the chosen server first when it
// lacks it, through this machine's Orca (fork.serverSetup.run), then the create goes on as named.
import type { RuntimeClient } from '../runtime/client'
import { RuntimeClientError } from '../runtime/connection/types'
import { resolveHostFlagTarget } from '../hosts/execution-host-flag'
import { describeForkServerSetupReadiness } from '../../shared/fork/server-setup'
import {
  FORK_SERVER_SETUP_CLONE_TIMEOUT_MS,
  FORK_SERVER_SETUP_READINESS_TIMEOUT_MS,
  FORK_SERVER_SETUP_RUN_METHOD,
  type ForkServerSetupRunResult
} from '../../shared/fork/server-setup-wire'

type Flags = Map<string, string | boolean>

export const FORK_SETUP_MISSING_FLAG = 'setup-missing'

/** Reads and drops `--setup-missing`, so stock routing never sees it. */
export function takeForkSetupMissing(flags: Flags): boolean {
  if (!flags.has(FORK_SETUP_MISSING_FLAG)) {
    return false
  }
  const value = flags.get(FORK_SETUP_MISSING_FLAG)
  flags.delete(FORK_SETUP_MISSING_FLAG)
  return value !== 'false'
}

/** The stderr lines for a finished setup. */
export function formatForkServerSetupNote(result: ForkServerSetupRunResult): string[] {
  if (!result.cloned) {
    return []
  }
  const lines = [`Set up the project on ${result.serverName}: cloned into ${result.clonePath}.`]
  if (result.readiness) {
    lines.push(`  ${describeForkServerSetupReadiness(result.readiness)}`)
    lines.push(...result.readiness.notes.map((note) => `  note: ${note}`))
  }
  return lines
}

/** Sets the project up on one paired server through this machine's Orca. */
export async function forkSetUpProjectOnServer(
  client: RuntimeClient,
  environmentId: string,
  project: string
): Promise<ForkServerSetupRunResult> {
  try {
    const { result } = await client.call<ForkServerSetupRunResult>(
      FORK_SERVER_SETUP_RUN_METHOD,
      { environmentId, project },
      { timeoutMs: FORK_SERVER_SETUP_CLONE_TIMEOUT_MS + FORK_SERVER_SETUP_READINESS_TIMEOUT_MS }
    )
    const lines = formatForkServerSetupNote(result)
    if (lines.length > 0) {
      process.stderr.write(`${lines.join('\n')}\n`)
    }
    return result
  } catch (error) {
    if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
      throw new RuntimeClientError(
        'incompatible_runtime',
        'The Orca running here cannot set projects up on a server (a Blackfish feature). Drop --setup-missing.'
      )
    }
    throw error
  }
}

/** `--setup-missing` with a named host: set it up first when that host is a paired server. */
export async function forkSetUpNamedHost(flags: Flags, client: RuntimeClient): Promise<void> {
  const project = flags.get('project')
  if (typeof project !== 'string' || !project) {
    throw new RuntimeClientError('invalid_argument', '--setup-missing needs --project.')
  }
  const host = await resolveHostFlagTarget(flags, client)
  if (host?.kind !== 'runtime') {
    throw new RuntimeClientError(
      'invalid_argument',
      '--setup-missing sets a project up on a paired server: pass --host auto or --host runtime:<id>.'
    )
  }
  await forkSetUpProjectOnServer(client, host.environmentId, project)
}
