// Letters and the board (FORK.md, SLRM-2389): `orca letter` and `orca board`. The subcommands
// come first so their words are never read as another command's value.
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

const SIGN_NOTE =
  'Run it from your chat or terminal agent: the host signs the letter with that chat. Run outside any agent it is signed "shell".'

export const FORK_LETTERS_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['letter', 'send'],
    summary: 'Send a letter to another chat; it is delivered when that chat ends its turn',
    usage: 'orca letter send <to> <text> [--cite <letter-id>] [--host <server>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'to', 'text', 'cite', 'host'],
    positionalArgs: ['to', 'text'],
    notes: [
      '<to> is a chat session id or a terminal agent pane key, or a unique prefix of 4+ characters; `orca letter chats` lists them.',
      'The recipient reads it between its turns, framed as untrusted words from another agent, with the command to answer.',
      '--cite names an earlier letter between the two chats that this one answers.',
      '--host names the paired server (id or name) the recipient runs on; the letter is handed over at once. Answers from there come back by themselves.',
      'Letters are rate-limited per chat (Settings > Blackfish > Chats).',
      SIGN_NOTE
    ],
    examples: [
      'orca letter send 3f2a9c "The API branch is merged; rebase on main."',
      'orca letter send 3f2a9c "Done, see PR 12." --cite a1b2c3d4e5f6',
      'orca letter send 77de "Can you run the GPU tests?" --host gpu-box'
    ]
  },
  {
    path: ['letter', 'list'],
    summary: "List a chat's letters, newest first",
    usage: 'orca letter list [--chat <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'chat'],
    notes: [
      'Without --chat it lists the letters of the chat that runs it, or every letter on this host when run outside any agent.',
      '--environment reads another host.'
    ],
    examples: ['orca letter list', 'orca letter list --chat 3f2a9c --json']
  },
  {
    path: ['letter', 'chats'],
    summary: 'List the chats on this host a letter can reach, with their ids',
    usage: 'orca letter chats [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: ['--environment lists another host.'],
    examples: ['orca letter chats']
  },
  {
    path: ['board', 'add'],
    summary: 'File an ask for the user: REVIEW, DECIDE or DO',
    usage: 'orca board add <type> <title> [--body <text>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'type', 'title', 'body'],
    positionalArgs: ['type', 'title'],
    notes: [
      'REVIEW: something to look at. DECIDE: a choice between options (put them in --body). DO: an act only the user can do.',
      "It shows above your chat's message box and in the Decision inbox until the user marks it done or throws it back with a note, which you get as a message.",
      'Each chat holds a few open asks at most, and filing counts against its letter rate.',
      SIGN_NOTE
    ],
    examples: [
      'orca board add REVIEW "PR 12: the new login flow" --body "https://github.com/org/repo/pull/12"',
      'orca board add DECIDE "Keep the old API?" --body "A: keep for a release. B: drop now."'
    ]
  },
  {
    path: ['board', 'list'],
    summary: 'List the open asks on the board',
    usage: 'orca board list [--all] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'all'],
    notes: ['--all also lists the asks closed in the last week.'],
    examples: ['orca board list', 'orca board list --all --json']
  },
  {
    path: ['board', 'done'],
    summary: 'Mark an ask done',
    usage: 'orca board done <id> [--note <text>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'note'],
    positionalArgs: ['id'],
    notes: [
      'The user, or the agent that filed it, marks an ask done. An id prefix of 4+ characters is enough.'
    ],
    examples: ['orca board done 3f2a']
  },
  {
    path: ['board', 'back'],
    summary: 'Throw an ask back to the chat that filed it, with a note',
    usage: 'orca board back <id> <note> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'note'],
    positionalArgs: ['id', 'note'],
    notes: [
      'Only the user throws an ask back. The chat gets the note as a message between its turns.'
    ],
    examples: ['orca board back 3f2a "Split this into two PRs first."']
  }
]
