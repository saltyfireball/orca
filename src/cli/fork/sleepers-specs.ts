// Sleepers (FORK.md): `orca sleepers`.
import { GLOBAL_FLAGS, type CommandSpec } from '../args'

const ID_NOTE =
  'An id is a chat session id or a terminal agent pane key, as `orca sleepers list` prints it; a unique prefix is enough.'

export const FORK_SLEEPERS_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['sleepers', 'list'],
    summary: 'List native chats and terminal agents with their sleep state and idle time',
    usage: 'orca sleepers list [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'States: working, needs input (asked you something), awake idle (its process runs with nothing to do), asleep (no process).',
      'A pinned chat never sleeps on idle. Each host lists its own agents; --environment picks another host.'
    ],
    examples: ['orca sleepers list', 'orca sleepers list --json']
  },
  {
    path: ['sleepers', 'sleep'],
    summary: 'Stop the provider of an idle native chat now; the next message starts it again',
    usage: 'orca sleepers sleep <id> | --all-idle [--except-visible] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'all-idle', 'except-visible'],
    positionalArgs: ['id'],
    notes: [
      'It runs the same idle check as the automatic sweep, so a chat with a running turn, a pending question, queued messages or live subagents is left awake and reported busy.',
      '--all-idle sleeps every idle chat that is not pinned; --except-visible also leaves chats on screen awake.',
      'Terminal agents sleep through workspace sleep and terminal hibernation, not here.',
      ID_NOTE
    ],
    examples: ['orca sleepers sleep 3f2a', 'orca sleepers sleep --all-idle']
  },
  {
    path: ['sleepers', 'wake'],
    summary: 'Open a sleeping chat on the desktop; its provider starts on the next message',
    usage: 'orca sleepers wake <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    positionalArgs: ['id'],
    notes: [ID_NOTE],
    examples: ['orca sleepers wake 3f2a']
  },
  {
    path: ['sleepers', 'pin'],
    summary: 'Keep a native chat awake: the idle sweep never puts it to sleep',
    usage: 'orca sleepers pin <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    positionalArgs: ['id'],
    notes: ['Sleep now still works on a pinned chat when you name it.', ID_NOTE],
    examples: ['orca sleepers pin 3f2a']
  },
  {
    path: ['sleepers', 'unpin'],
    summary: 'Let a pinned native chat sleep on idle again',
    usage: 'orca sleepers unpin <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    positionalArgs: ['id'],
    notes: [ID_NOTE],
    examples: ['orca sleepers unpin 3f2a']
  }
]
