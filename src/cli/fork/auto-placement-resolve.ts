// Auto placement (FORK.md, SLRM-2266): `orchestration worker-start --on auto` and
// `worktree create --project <p> --host auto` ask this machine's Orca to pick the machine with the
// most spare CPU and memory, then run as if that machine had been named. With the "pick a machine
// when none is named" setting on, the same happens when the flag is left out and more than one
// machine could take the work. One hook in src/cli/index.ts calls this before routing.
import type { RuntimeClient } from '../runtime/client'
import { RuntimeClientError } from '../runtime/types'
import type { ProjectHostSetup } from '../../shared/project-types'
import { findProjectSetups, setupHostId } from '../projects/project-selector'
import {
  describeForkPlacementCandidate,
  FORK_AUTO_PLACEMENT_VALUE,
  FORK_PLACEMENT_LOCAL_KEY,
  type ForkPlacementPick
} from '../../shared/fork/auto-placement'
import type { ForkPlacementPickResult } from '../../shared/fork/auto-placement-wire'

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
  params: { hosts?: string[]; repo?: string; unnamed?: boolean },
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
      'No machine can take this work: every one is manual only, unreachable, or lacks the repo.',
      result.ranked
    )
  }
  return result
}

function note(chosen: ForkPlacementPick, flag: string): void {
  if (!chosen.picked) {
    return
  }
  const others = chosen.ranked.filter((candidate) => candidate !== chosen.picked)
  const lines = [
    `Auto placement (${flag}): ${describeForkPlacementCandidate(chosen.picked)}`,
    ...others.map((candidate) => `  not picked: ${describeForkPlacementCandidate(candidate)}`)
  ]
  process.stderr.write(`${lines.join('\n')}\n`)
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
  const local = client()
  if (unnamed && (await pick(local, { hosts: [], unnamed: true }, false)) === null) {
    return
  }
  const listed = await local.call<{ setups: ProjectHostSetup[] }>('projectHostSetup.list')
  const ready = (await findProjectSetups(local, listed.result.setups, project as string)).filter(
    (setup) => setup.setupState === 'ready'
  )
  const hosts = [...new Set(ready.map(setupHostId))]
  if (hosts.length === 0) {
    if (unnamed) {
      return
    }
    refuse(`No ready setup found for --project ${project} on any host.`)
  }
  if (unnamed && hosts.length < 2) {
    return
  }
  const chosen = await pick(local, { hosts, ...(unnamed ? { unnamed: true } : {}) }, explicit)
  if (!chosen?.picked) {
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
