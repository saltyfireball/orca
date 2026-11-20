// SLRM-2428 (FORK.md "Quick task"): `orca quick-task`.
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

export const FORK_QUICK_TASK_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['quick-task'],
    summary: 'Hand a task to the router bot, which passes it to the bot that owns it',
    usage: 'orca quick-task <text>... [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'text'],
    positionalArgs: ['text'],
    variadicPositional: true,
    repeatableFlags: ['text'],
    notes: [
      'The same as the quick task box (Settings > Blackfish > Chats > Quick task): the task starts a new chat on the router bot (Dispatcher unless set), made on first use. The router reads `orca bot list`, which includes bots on paired servers, runs the placement command for code work, and hands the task to the owning bot in a new chat.',
      'Run it yourself, not from an agent: agents hand work to a bot with `orca orchestration send --to bot:<name> --type handoff`.'
    ],
    examples: [
      'orca quick-task add a dark mode toggle to the settings page',
      'orca quick-task "fix the flaky login test in the api repo"'
    ]
  }
]
