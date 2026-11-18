// Auto placement (FORK.md, SLRM-2266): `orchestration worker-start --on auto` and
// `worktree create --project <p> --host auto` ask this machine's Orca to pick the machine with the
// most spare CPU and memory, then run as if that machine had been named. With the "pick a machine
// when none is named" setting on, the same happens when the flag is left out and more than one
// machine could take the work. One hook in src/cli/index.ts calls this before routing.
import type { RuntimeClient } from '../runtime/client'
import { RuntimeClientError } from '../runtime/connection/types'
import type { ProjectHostSetup } from '../../shared/project/project-types'
import { findProjectSetups, setupHostId } from '../projects/project-selector'
import {
  describeForkPlacementCandidate,
  FORK_AUTO_PLACEMENT_VALUE,
  FORK_PLACEMENT_LOCAL_KEY,
  type ForkPlacementPick
} from '../../shared/fork/auto-placement'
import type { ForkPlacementPickResult } from '../../shared/fork/auto-placement-wire'
import {
  forkSetUpNamedHost,
  forkSetUpProjectOnServer,
  takeForkSetupMissing
} from './server-setup-cli'

type Flags = Map<string, string | boolean>

export type ForkAutoPlacementCommand = { commandPath: readonly string[]; flags: Flags }

const PICK_TIMEOUT_MS = 20_000
const NEW_WORKTREES = new Set(['new-child', 'new-top-level'])

function text(flags: Flags, name: string): string | undefined {
  const value = flags.get(name)
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function refuse(message: string, ranked?: ForkPlacementPick['ranked']): never {
  throw new RuntimeClientError('invalid_argument', message, {
    ...(ranked ? { machines: ranked.map(describeForkPlacementCandidate) } : {}),
    nextSteps: [
      'Run `orca placement` to see each machine, its load and its placement setting.',
      'Name a machine instead of auto, or change a machine from manual only in Settings > Blackfish.'
    ]
  })
}

/** Asks the local Orca for a pick; null when it is off (unnamed) or this Orca has no picker. */
async function pick(
  client: RuntimeClient,
  params: {
    hosts?: string[]
    repo?: string
    project?: string
    unnamed?: boolean
    setupMissing?: boolean
  },
  explicit: boolean
): Promise<ForkPlacementPick | null> {
  let result: ForkPlacementPickResult
  try {
    result = (
      await client.call<ForkPlacementPickResult>('fork.placement.pick', params, {
        timeoutMs: PICK_TIMEOUT_MS
      })
    ).result
  } catch (error) {
    if (!explicit) {
      // The unnamed pick is a convenience: anything wrong with it leaves stock behaviour alone.
      return null
    }
    if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
      throw new RuntimeClientError(
        'incompatible_runtime',
        'The Orca running here cannot pick a machine (auto placement is a Blackfish feature). Name a machine instead.'
      )
    }
    throw error
  }
  if (result.off === true) {
    return null
  }
  if (!result.picked) {
    if (!explicit) {
      return null
    }
    refuse(
      'No machine can take this work: every one is manual only, unreachable, or lacks the repo or a ready project setup.',
      result.ranked
    )
  }
  return result
}

/** The pick, then every other machine once. Picked and ranked arrive as separate JSON objects,
 *  so the pick is matched by host key, not identity. */
export function formatForkPlacementNote(chosen: ForkPlacementPick, flag: string): string[] {
  const picked = chosen.picked
  if (!picked) {
    return []
  }
  return [
    `Auto placement (${flag}): picked ${describeForkPlacementCandidate(picked)}`,
    ...chosen.ranked
      .filter((candidate) => candidate.hostKey !== picked.hostKey)
      .map((candidate) => `  not picked: ${describeForkPlacementCandidate(candidate)}`)
  ]
}

function note(chosen: ForkPlacementPick, flag: string): void {
  const lines = formatForkPlacementNote(chosen, flag)
  if (lines.length > 0) {
    process.stderr.write(`${lines.join('\n')}\n`)
  }
}

function remoteSelected(flags: Flags): boolean {
  return (
    flags.has('environment') ||
    flags.has('pairing-code') ||
    Boolean(process.env.ORCA_ENVIRONMENT?.trim() || process.env.ORCA_PAIRING_CODE?.trim())
  )
}

async function resolveWorkerStart(flags: Flags, client: () => RuntimeClient): Promise<void> {
  const explicit = text(flags, 'on') === FORK_AUTO_PLACEMENT_VALUE
  const worktree = text(flags, 'worktree')
  const repo = text(flags, 'repo')
  const unnamed =
    !explicit &&
    !flags.has('on') &&
    !flags.has('terminal') &&
    worktree !== undefined &&
    NEW_WORKTREES.has(worktree) &&
    repo !== undefined &&
    !remoteSelected(flags)
  if (!explicit && !unnamed) {
    return
  }
  if (explicit && (!worktree || !NEW_WORKTREES.has(worktree) || flags.has('terminal'))) {
    refuse(
      '--on auto starts a worker in a new worktree: pass --worktree new-child or new-top-level, without --terminal.'
    )
  }
  if (explicit && (flags.has('environment') || flags.has('pairing-code'))) {
    refuse(
      '--on auto picks among this machine and its paired servers; drop --environment or the pairing code.'
    )
  }
  if (explicit && !repo) {
    refuse('--on auto needs --repo, so only machines that have the repo are picked.')
  }
  const chosen = await pick(client(), { repo, ...(unnamed ? { unnamed: true } : {}) }, explicit)
  if (!chosen?.picked) {
    return
  }
  const { hostKey } = chosen.picked
  if (hostKey === FORK_PLACEMENT_LOCAL_KEY) {
    flags.delete('on')
    // --on kept an ambient ORCA_ENVIRONMENT from rerouting the start; `local` keeps that true.
    flags.set('environment', 'local')
  } else {
    flags.set('on', hostKey.slice('runtime:'.length))
  }
  note(chosen, '--on')
}

async function resolveWorktreeCreate(flags: Flags, client: () => RuntimeClient): Promise<void> {
  const explicit = text(flags, 'host') === FORK_AUTO_PLACEMENT_VALUE
  const project = text(flags, 'project')
  // SLRM-2312: --setup-missing lets the pick (or a named server) clone the project first.
  const setupMissing = takeForkSetupMissing(flags)
  if (setupMissing && remoteSelected(flags)) {
    refuse('--setup-missing works from this machine; drop --environment or the pairing code.')
  }
  if (setupMissing && !explicit) {
    await forkSetUpNamedHost(flags, client())
    return
  }
  const unnamed =
    !explicit &&
    !flags.has('host') &&
    project !== undefined &&
    !flags.has('project-host-setup') &&
    !flags.has('repo') &&
    !remoteSelected(flags)
  if (!explicit && !unnamed) {
    return
  }
  if (explicit && (!project || flags.has('project-host-setup'))) {
    refuse(
      '--host auto needs --project (and no --project-host-setup): it picks among the machines the project is set up on.'
    )
  }
  if (explicit && remoteSelected(flags)) {
    refuse(
      '--host auto picks among this machine and its paired servers; drop --environment or the pairing code.'
    )
  }
  if (project === undefined) {
    return
  }
  const local = client()
  if (unnamed && (await pick(local, { hosts: [], unnamed: true }, false)) === null) {
    return
  }
  const listed = await local.call<{ setups: ProjectHostSetup[] }>('projectHostSetup.list')
  const ready = (await findProjectSetups(local, listed.result.setups, project)).filter(
    (setup) => setup.setupState === 'ready'
  )
  // Setups are kept per Orca: this list holds this machine's own (and any it keeps for other
  // hosts), so the pick also asks each paired server whether the project is set up there.
  const hosts = [...new Set(ready.map(setupHostId))]
  const chosen = await pick(
    local,
    {
      hosts,
      project,
      ...(unnamed ? { unnamed: true } : {}),
      ...(setupMissing ? { setupMissing: true } : {})
    },
    explicit
  )
  if (!chosen?.picked) {
    return
  }
  if (chosen.picked.needsSetup) {
    note(chosen, '--host')
    await forkSetUpProjectOnServer(local, chosen.picked.hostKey.slice('runtime:'.length), project)
    flags.set('host', chosen.picked.hostKey)
    return
  }
  const eligible = chosen.ranked.filter((candidate) => candidate.status === 'eligible').length
  // Unnamed: leave a sole machine stock routing would reach anyway alone.
  if (unnamed && eligible < 2 && hosts.includes(chosen.picked.hostKey)) {
    return
  }
  flags.set('host', chosen.picked.hostKey)
  note(chosen, '--host')
}

/** Rewrites `--on auto` / `--host auto` (or an unnamed machine, when that setting is on) in place. */
export async function forkResolveAutoPlacement(
  parsed: ForkAutoPlacementCommand,
  localClient: () => RuntimeClient
): Promise<void> {
  const command = parsed.commandPath.join(' ')
  if (command === 'orchestration worker-start') {
    await resolveWorkerStart(parsed.flags, localClient)
  } else if (command === 'worktree create') {
    await resolveWorktreeCreate(parsed.flags, localClient)
  }
}
