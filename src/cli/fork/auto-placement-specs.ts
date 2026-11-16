// Auto placement (FORK.md, SLRM-2266): `orca placement`, and the `auto` value of --on and --host.
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

export const FORK_AUTO_PLACEMENT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['placement'],
    summary: 'Rank this machine and its paired servers by spare CPU and memory for new work',
    usage: 'orca placement [--repo <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo'],
    notes: [
      'This is the ranking `--on auto` and `--host auto` use; the first eligible machine is the one they would pick now.',
      'Each machine has a placement setting in Settings > Blackfish > Auto placement: prefer, normal, less often or manual only. Manual only machines are never picked, only named.',
      'A paired server answers only when it runs a Blackfish with the load probe; one that does not, or does not answer within a few seconds, is skipped.',
      'With --repo, machines where that repo selector does not resolve are skipped.'
    ],
    examples: ['orca placement', 'orca placement --repo id:3f2a --json']
  }
]

const NOTES: Record<string, string> = {
  'orchestration worker-start':
    "Blackfish: --on auto picks the machine (this one or a paired server) with the most spare CPU and memory, weighted by each machine's placement setting; it needs --worktree new-child or new-top-level and --repo, and skips machines without the repo. `orca placement` shows the ranking.",
  'worktree create':
    "Blackfish: --host auto (with --project) picks, among the machines the project is set up on, the one with the most spare CPU and memory, weighted by each machine's placement setting. `orca placement` shows the ranking."
}

/** Notes `--on auto` and `--host auto` on the commands that take them; one hook on the spec list. */
export function withForkAutoPlacementNotes(specs: CommandSpec[]): CommandSpec[] {
  return specs.map((spec) => {
    const extra = NOTES[spec.path.join(' ')]
    return extra ? { ...spec, notes: [...(spec.notes ?? []), extra] } : spec
  })
}
