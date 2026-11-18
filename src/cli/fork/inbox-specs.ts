// Idle recovery (FORK.md), item E1: `orca inbox`, the Decision inbox from the CLI.
// Contract: the three commands below, each through one `fork.idleRecovery.*` RPC of the host.
// The command names are fixed here because the start-up command list names `inbox`.
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'
import { FORK_BABYSIT_COMMAND_SPECS } from './babysit-specs'

const ID_NOTE =
  'An id is a chat session id or a terminal agent pane key, as `orca inbox list` prints it; a unique prefix is enough.'

export const FORK_INBOX_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['inbox', 'list'],
    summary: 'List chats that wait on you or stalled after their turn ended',
    usage: 'orca inbox list [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Empty unless idle recovery is on (Settings > Blackfish > Idle recovery, or `orca settings set forkIdleSweepMode inbox`).',
      'Each host lists its own chats; --environment picks another host.'
    ],
    examples: ['orca inbox list', 'orca inbox list --json']
  },
  {
    path: ['inbox', 'answer'],
    summary: 'Send your answer to a chat that waits on you or stalled',
    usage: 'orca inbox answer <id> <text> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'text'],
    positionalArgs: ['id', 'text'],
    notes: [
      'The text goes to the chat unchanged, as a message from you.',
      'For a stalled chat the answer tells the agent how to go on.',
      ID_NOTE
    ],
    examples: ['orca inbox answer 3f2a "Yes, use the second option"']
  },
  {
    path: ['inbox', 'pause'],
    summary: 'Pause idle recovery for one chat: it is not read or woken until resumed',
    usage: 'orca inbox pause <id> [--resume] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'resume'],
    positionalArgs: ['id'],
    notes: [
      'A chat already in the inbox keeps its row as it was, marked (paused) and left out of the counts. You can still answer it.',
      '--resume lets idle recovery look at the chat again.',
      'On a row an agent guard paused, --resume lifts that pause (orca guards resume does the same).',
      ID_NOTE
    ],
    examples: ['orca inbox pause 3f2a', 'orca inbox pause 3f2a --resume']
  },
  // SLRM-2386: `orca babysit`, whose stuck pull requests join this inbox; listed here so the
  // upstream spec list needs no line of its own.
  ...FORK_BABYSIT_COMMAND_SPECS
]
