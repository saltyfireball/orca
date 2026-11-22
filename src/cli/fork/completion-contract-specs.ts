// Completion contract (BAD-676, FORK.md): the done-check flags on the two commands that create a Task.
import type { CommandSpec } from '../discovery/command-spec'
import { FORK_DONE_CONTRACT_FLAGS } from './completion-contract-flag'
import { FORK_REVIEW_FLAGS } from './reviewer-gate-flag'

const PATHS = ['orchestration task-create', 'orchestration worker-start']

const NOTE =
  "--done-check '<command>' (repeatable) runs that command in the worker's workspace when it reports done; --require-pr-checks needs every required check on its pull request's pushed head to be green. A failure goes back to the worker as untrusted output and the Task stays open, up to --done-max-rounds (default: Settings > Blackfish, 2), then it escalates to this Run's coordinator and the Decision inbox. A Task without them settles as before."

const REVIEW_NOTE =
  "--review has a second agent (the other provider than the worker's, or --review-agent claude|codex) review the worker's exact head commit, read-only, before its done settles the Task. Findings go to the worker as a message and the Task stays open until it reports again; a clean review settles it. --review-focus correctness|security|perf aims it; --review-max-rounds (default: Settings > Blackfish, 2) caps the rounds, then the Task escalates to this Run's coordinator."

/** Adds the done-check and review flags; one hook on the spec list. */
export function withForkDoneContractFlags(specs: CommandSpec[]): CommandSpec[] {
  return specs.map((spec) =>
    PATHS.includes(spec.path.join(' '))
      ? {
          ...spec,
          usage: spec.usage.replace(
            / \[--json\]$/,
            " [--done-check '<command>'] [--require-pr-checks] [--done-max-rounds <n>] [--review] [--review-focus <focus>] [--review-agent <agent>] [--review-max-rounds <n>] [--json]"
          ),
          allowedFlags: [...spec.allowedFlags, ...FORK_DONE_CONTRACT_FLAGS, ...FORK_REVIEW_FLAGS],
          repeatableFlags: [...(spec.repeatableFlags ?? []), 'done-check'],
          notes: [...(spec.notes ?? []), NOTE, REVIEW_NOTE]
        }
      : spec
  )
}
