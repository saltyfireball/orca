// Worker retry policy (BAD-681, FORK.md "Worker retry policy"): `orca retry policy` and `orca retry show`.
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

export const FORK_WORKER_RETRY_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['retry', 'policy'],
    summary:
      "Show or set a Run's policy for restarting a worker that exited, was lost or hit a provider error",
    usage:
      'orca retry policy [--run <run_id>] [--on | --off] [--max <0-10>] [--backoff <seconds>] [--clear] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'run', 'on', 'off', 'max', 'backoff', 'clear'],
    notes: [
      "Off unless Settings > Blackfish (`forkWorkerRetry`) or the Run turns it on. A retry restarts the worker in the same workspace after a backoff (--backoff seconds for the first, then double, capped by `forkWorkerRetryMaxBackoffSeconds`), at most --max times per Task (default 2). A worker that reported done or failed is never retried. --clear drops the Run's own policy. Without --run, the policy the settings give is shown."
    ],
    examples: [
      'orca retry policy --run run_1a2b3c --on --max 3',
      'orca retry policy --run run_1a2b3c --off'
    ]
  },
  {
    path: ['retry', 'show'],
    summary: 'List the automatic retries of a Task or a Run, with the reason and state of each',
    usage: 'orca retry show [--task <task_id>] [--run <run_id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'task', 'run'],
    examples: ['orca retry show --task task_1a2b3c']
  }
]
