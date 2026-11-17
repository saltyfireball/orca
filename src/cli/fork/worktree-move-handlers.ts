// SLRM-2265 (FORK.md "Worktree move"): `orca worktree move`, run from the CLI over the source's
// and the target's runtimes. The move itself is the shared runner; this file picks the hosts.
import { randomUUID } from 'node:crypto'
import type { CommandHandler } from '../dispatch/dispatch'
import { getRequiredStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { RuntimeClient } from '../runtime/client'
import { RuntimeClientError } from '../runtime/connection/types'
import {
  getRequiredWorktreeSelector,
  resolveCurrentWorktreeSelector
} from '../workspace-selection/workspace-selector'
import { findEnvironmentByName } from '../hosts/host-selector-alternatives'
import { isLocalEnvironmentSelector } from '../hosts/local-environment-selector'
import {
  LOCAL_EXECUTION_HOST_ID,
  parseExecutionHostId
} from '../../shared/execution-host/execution-host'
import { resolveWorktreeMoveSettings } from '../../shared/fork/worktree-move/worktree-move-settings'
import {
  runWorktreeMove,
  type WorktreeMoveRunResult
} from '../../shared/fork/worktree-move/worktree-move-runner'
import type { ForkSettingsGetResult } from '../../shared/fork/settings-wire'
import { formatWorktreeMoveResult } from './worktree-move-format'

/** A move creates a worktree and copies transcripts; give each call room. */
const MOVE_CALL_TIMEOUT_MS = 10 * 60_000

export type WorktreeMoveHost = { hostId: string; environmentId: string | null; label: string }

async function environments(userDataPath: string): Promise<{ id: string; name: string }[]> {
  const { listEnvironments } =
    await import('../../shared/remote-runtime/host-store/runtime-environment-store.js')
  return (await listEnvironments(userDataPath)).map((entry) => ({ id: entry.id, name: entry.name }))
}

/** `local`, `runtime:<id>` or a paired server's name, as a host id and the environment to dial. */
export async function resolveWorktreeMoveHost(
  value: string,
  userDataPath: string
): Promise<WorktreeMoveHost> {
  const parsed = parseExecutionHostId(value)
  if (parsed?.kind === 'local' || isLocalEnvironmentSelector(value as unknown)) {
    return { hostId: LOCAL_EXECUTION_HOST_ID, environmentId: null, label: 'this machine' }
  }
  if (parsed?.kind === 'ssh') {
    return { hostId: parsed.id, environmentId: null, label: parsed.targetId }
  }
  const known = await environments(userDataPath)
  const wanted = parsed?.kind === 'runtime' ? parsed.environmentId : value.trim()
  const found = findEnvironmentByName(known, wanted)
  if (!found) {
    throw new RuntimeClientError(
      'invalid_argument',
      `Unknown host: ${value}. Use local, runtime:<environment-id> or a paired server name.`,
      { knownEnvironments: known, nextSteps: ['Run `orca host list` to see the hosts.'] }
    )
  }
  return { hostId: `runtime:${found.id}`, environmentId: found.id, label: found.name }
}

async function readSettings(client: RuntimeClient) {
  try {
    const reply = await client.call<ForkSettingsGetResult>('fork.settings.get', {})
    return resolveWorktreeMoveSettings(
      reply.result.values.forkWorktreeMove as Parameters<typeof resolveWorktreeMoveSettings>[0]
    )
  } catch {
    // An older host without the settings RPC moves with the defaults.
    return resolveWorktreeMoveSettings(undefined)
  }
}

export const FORK_WORKTREE_MOVE_HANDLERS: Record<string, CommandHandler> = {
  'worktree move': async ({ flags, client, cwd, json }) => {
    const to = getRequiredStringFlag(flags, 'to')
    const selector = flags.has('worktree')
      ? await getRequiredWorktreeSelector(flags, 'worktree', cwd, client)
      : await resolveCurrentWorktreeSelector(cwd, client, 'worktree')
    const target = await resolveWorktreeMoveHost(to, client.userDataPath)
    const source = client.environmentSelector
      ? await resolveWorktreeMoveHost(client.environmentSelector, client.userDataPath)
      : { hostId: LOCAL_EXECUTION_HOST_ID, environmentId: null, label: 'this machine' }
    const targetClient =
      target.hostId.startsWith('ssh:') || target.hostId === source.hostId
        ? client
        : new RuntimeClient(client.userDataPath, MOVE_CALL_TIMEOUT_MS, null, target.environmentId)
    let runtimeId = ''
    const result: WorktreeMoveRunResult = await runWorktreeMove({
      call: async (side, method, params) => {
        const reply = await (side === 'source' ? client : targetClient).call<unknown>(
          method,
          params,
          { timeoutMs: MOVE_CALL_TIMEOUT_MS }
        )
        runtimeId ||= side === 'source' ? reply._meta.runtimeId : ''
        return reply.result
      },
      worktree: selector,
      sourceHostId: source.hostId,
      targetHostId: target.hostId,
      targetLabel: target.label,
      settings: await readSettings(client),
      stopTurns: flags.get('stop-turns') === true,
      dryRun: flags.get('dry-run') === true,
      randomUuid: randomUUID,
      onStep: json ? undefined : (step) => process.stderr.write(`move: ${step}\n`)
    })
    if (result.kind === 'refuse' || result.kind === 'ask') {
      const hint = result.kind === 'ask' ? ' Pass --stop-turns to stop them and move.' : ''
      throw new RuntimeClientError('invalid_argument', `${result.plan.message}${hint}`, {
        code: result.plan.code
      })
    }
    printResult(
      { id: randomUUID(), ok: true, result, _meta: { runtimeId } },
      json,
      formatWorktreeMoveResult
    )
  }
}
