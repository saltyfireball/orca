// Snooze (FORK.md, SLRM-2269): `orca snooze`. `list` and `wake` come first, so their words are
// never read as the bare command's target.
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

const STATE_NOTE =
  'Snoozes are kept by the Orca whose sidebar shows them (this machine), also for workspaces on paired servers; run these without --environment.'

export const FORK_SNOOZE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['snooze', 'list'],
    // An alias makes the positional pass match `snooze list` before the bare command's target.
    aliases: [['snooze', 'ls']],
    summary: 'List snoozed workspaces and chats with when each comes back',
    usage: 'orca snooze list [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [STATE_NOTE],
    examples: ['orca snooze list', 'orca snooze list --json']
  },
  {
    path: ['snooze', 'wake'],
    summary: 'End a snooze now; the workspace or chat returns to its place in the sidebar',
    usage: 'orca snooze wake <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    positionalArgs: ['id'],
    notes: [
      'An id is as `orca snooze list` prints it; a unique prefix of 4+ characters is enough.'
    ],
    examples: ['orca snooze wake 3f2a9c']
  },
  {
    path: ['snooze'],
    summary: 'Hide a workspace or chat from the sidebar until a time, its merge or some idle days',
    usage:
      'orca snooze [<workspace selector>|chat:<id>] --until <time|merge|idle:Nd> [--host runtime:<id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'target', 'until', 'host'],
    positionalArgs: ['target'],
    notes: [
      'Without a target it snoozes the workspace of the current folder. A workspace selector is what `orca worktree show --worktree` takes (path:, id:, branch: and the rest).',
      'chat:<id> snoozes a chat (its session id or a unique prefix, as `orca sleepers list` shows) or a terminal agent (its pane key).',
      '--until takes merge (its pull request merges), idle:<days>d (it has sat idle that long), a duration (90m, 2h, 3d, 1w), evening, tomorrow, monday, a time (17:30) or a date and time (2026-11-20T09:00).',
      'It comes back early when it needs an approval or asks a question, when its agent fails, and when you open it (each can be turned off in Settings > Blackfish).',
      'A workspace on a paired server: --host runtime:<environment-id> with the workspace id as the sidebar has it.',
      STATE_NOTE
    ],
    examples: [
      'orca snooze --until tomorrow',
      'orca snooze path:/work/repo-feature --until merge',
      'orca snooze chat:3f2a --until 2h',
      'orca snooze branch:fix-login --until idle:3d'
    ]
  }
]
