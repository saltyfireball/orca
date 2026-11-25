// Completion contract (BAD-676, FORK.md): the done-check flags on the two commands that create a Task.
import type { CommandSpec } from '../discovery/command-spec'
import { FORK_DONE_CONTRACT_FLAGS } from './completion-contract-flag'
import { FORK_REVIEW_FLAGS } from './reviewer-gate-flag'
import { FORK_RESULT_FLAGS, FORK_RESULT_SCHEMA_FLAGS } from './result-schema-flag'

const PATHS = ['orchestration task-create', 'orchestration worker-start']

const NOTE =
  "--done-check '<command>' (repeatable) runs that command in the worker's workspace when it reports done; --require-pr-checks needs every required check on its pull request's pushed head to be green. A failure goes back to the worker as untrusted output and the Task stays open, up to --done-max-rounds (default: Settings > Blackfish, 2), then it escalates to this Run's coordinator and the Decision inbox. A Task without them settles as before."

const REVIEW_NOTE =
  "--review has a second agent (the other provider than the worker's, or --review-agent claude|codex) review the worker's exact head commit, read-only, before its done settles the Task. Findings go to the worker as a message and the Task stays open until it reports again; a clean review settles it. --review-focus correctness|security|perf aims it; --review-max-rounds (default: Settings > Blackfish, 2) caps the rounds, then the Task escalates to this Run's coordinator."

const RESULT_SCHEMA_NOTE =
  "--result-schema '<json>' (or --result-schema-file <path>) declares a JSON Schema (draft-07; no remote $ref, pattern or format; at most 16 KB) the worker's result must match. The worker sends it with worker_done --result-file; the Task settles only once a valid value is stored, a missing or invalid one goes back with the error and counts as a failed done check (same rounds), and worker-read --json and run-show --json return the stored value as forkResult. Retries and follow-ups inherit the schema, not the value."

const RESULT_NOTE =
  "--result '<json>' (or --result-file <path>), with --type worker_done only: the JSON result a Task with a result schema needs. Orca checks it against the schema and stores it on the Task; an invalid one sends the done back with the error."

/** BAD-816: `send` takes the worker's result. */
function withResultFlag(spec: CommandSpec): CommandSpec {
  return spec.path.join(' ') === 'orchestration send'
    ? {
        ...spec,
        usage: spec.usage.replace(
          / \[--json\]$/,
          ' [--result <json> | --result-file <path>] [--json]'
        ),
        allowedFlags: [...spec.allowedFlags, ...FORK_RESULT_FLAGS],
        notes: [...(spec.notes ?? []), RESULT_NOTE]
      }
    : spec
}

/** Adds the done-check, review and result flags; one hook on the spec list. */
export function withForkDoneContractFlags(specs: CommandSpec[]): CommandSpec[] {
  return specs.map(withResultFlag).map((spec) =>
    PATHS.includes(spec.path.join(' '))
      ? {
          ...spec,
          usage: spec.usage.replace(
            / \[--json\]$/,
            " [--done-check '<command>'] [--require-pr-checks] [--done-max-rounds <n>] [--review] [--review-focus <focus>] [--review-agent <agent>] [--review-max-rounds <n>] [--result-schema <json> | --result-schema-file <path>] [--json]"
          ),
          allowedFlags: [
            ...spec.allowedFlags,
            ...FORK_DONE_CONTRACT_FLAGS,
            ...FORK_REVIEW_FLAGS,
            ...FORK_RESULT_SCHEMA_FLAGS
          ],
          repeatableFlags: [...(spec.repeatableFlags ?? []), 'done-check'],
          notes: [...(spec.notes ?? []), NOTE, REVIEW_NOTE, RESULT_SCHEMA_NOTE]
        }
      : spec
  )
}
