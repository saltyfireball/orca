// Auto placement (FORK.md, SLRM-2266): `orca placement`, and the `auto` value of --on and --host.
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

export const FORK_AUTO_PLACEMENT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['placement'],
    summary: 'Rank this machine and its paired servers by spare CPU and memory for new work',
    usage: 'orca placement [--repo <selector>] [--project <id-or-name>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo', 'project'],
    notes: [
      'This is the ranking `--on auto` and `--host auto` use; the first eligible machine is the one they would pick now.',
      'Each machine has a placement setting in Settings > Blackfish > Auto placement: prefer, normal, less often or manual only. Manual only machines are never picked, only named.',
      'A paired server answers only when it runs a Blackfish with the load probe; one that does not, or does not answer within a few seconds, is skipped.',
      'With --repo, machines where that repo selector does not resolve are skipped.',
      'With --project, machines where that project has no ready setup of their own are skipped, as `worktree create --host auto` does. Each Orca keeps its own setups, so every paired server is asked.',
      'With --setup-missing as well, a paired server that lacks the project but could clone it counts too, marked "project will be set up here first".'
    ],
    examples: [
      'orca placement',
      'orca placement --repo id:3f2a --json',
      'orca placement --project github:owner/repo',
      'orca placement --project github:owner/repo --setup-missing'
    ]
  }
]

const NOTES: Record<string, string> = {
  'orchestration worker-start':
    "Blackfish: --on auto picks the machine (this one or a paired server) with the most spare CPU and memory, weighted by each machine's placement setting; it needs --worktree new-child or new-top-level and --repo, and skips machines without the repo. `orca placement` shows the ranking.",
  'worktree create':
    "Blackfish: --host auto (with --project) picks, among this machine and the paired servers that have a ready setup of the project, the one with the most spare CPU and memory, weighted by each machine's placement setting. `orca placement --project <p>` shows the ranking. Add --setup-missing to also consider paired servers that lack the project: the one picked (or the server named with --host) clones it from the project's git remote with its own git credentials into the folder set in Settings > Blackfish > Set up on a server (~/development by default), and what it lacks to build the project is listed."
}

/** Flags the fork adds to stock commands (SLRM-2312). */
const EXTRA_FLAGS: Record<string, string[]> = {
  'worktree create': ['setup-missing']
}

/** Notes `--on auto` and `--host auto` on the commands that take them; one hook on the spec list. */
export function withForkAutoPlacementNotes(specs: CommandSpec[]): CommandSpec[] {
  return specs.map((spec) => {
    const key = spec.path.join(' ')
    const extra = NOTES[key]
    const flags = EXTRA_FLAGS[key]
    return extra || flags
      ? {
          ...spec,
          ...(extra ? { notes: [...(spec.notes ?? []), extra] } : {}),
          ...(flags ? { allowedFlags: [...spec.allowedFlags, ...flags] } : {})
        }
      : spec
  })
}
