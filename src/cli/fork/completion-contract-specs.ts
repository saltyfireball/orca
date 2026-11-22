// Completion contract (BAD-676, FORK.md): the done-check flags on the two commands that create a Task.
import type { CommandSpec } from '../discovery/command-spec'
import { FORK_DONE_CONTRACT_FLAGS } from './completion-contract-flag'

const PATHS = ['orchestration task-create', 'orchestration worker-start']

const NOTE =
  "--done-check '<command>' (repeatable) runs that command in the worker's workspace when it reports done; --require-pr-checks needs every required check on its pull request's pushed head to be green. A failure goes back to the worker as untrusted output and the Task stays open, up to --done-max-rounds (default: Settings > Blackfish, 2), then it escalates to this Run's coordinator and the Decision inbox. A Task without them settles as before."

/** Adds the done-check flags; one hook on the spec list. */
export function withForkDoneContractFlags(specs: CommandSpec[]): CommandSpec[] {
  return specs.map((spec) =>
    PATHS.includes(spec.path.join(' '))
      ? {
          ...spec,
          usage: spec.usage.replace(
            / \[--json\]$/,
            " [--done-check '<command>'] [--require-pr-checks] [--done-max-rounds <n>] [--json]"
          ),
          allowedFlags: [...spec.allowedFlags, ...FORK_DONE_CONTRACT_FLAGS],
          repeatableFlags: [...(spec.repeatableFlags ?? []), 'done-check'],
          notes: [...(spec.notes ?? []), NOTE]
        }
      : spec
  )
}
