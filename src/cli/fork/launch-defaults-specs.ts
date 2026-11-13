// Fork launch defaults (FORK.md "Launch defaults"): `orca launch-defaults`.
import { GLOBAL_FLAGS, type CommandSpec } from '../args'

export const FORK_LAUNCH_DEFAULTS_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['launch-defaults'],
    summary: 'Show the model and effort each kind of launch runs, per agent',
    usage: 'orca launch-defaults [--agent <agent>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'agent'],
    notes: [
      'Kinds: interactive (desktop and mobile pickers), cli (orca agent launch, orca worktree create --agent), worker (orca orchestration worker-start) and automation (scheduled and run-now automations).',
      'An explicit --model or --effort, a picker choice, or a model in the agent arguments always wins. Next comes the default for the kind, set in Settings > Advanced > Launch defaults, then the app-wide default in Settings > Agents, then the config of the agent itself.',
      'The text output lists agents with a model set somewhere; --json lists every agent that takes a model at launch.'
    ],
    examples: [
      'orca launch-defaults',
      'orca launch-defaults --agent claude',
      'orca launch-defaults --json'
    ]
  }
]
