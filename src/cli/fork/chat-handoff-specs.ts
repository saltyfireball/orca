// Chat handoff (FORK.md, SLRM-2391): `orca chat handoff` and `orca chat history`.
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

const ID_NOTE =
  '<id> is the chat session id `orca agent launch` and `orca agent list` print. Run inside a chat, it defaults to that chat; on a paired host (--environment) it is required.'

export const FORK_CHAT_HANDOFF_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['chat', 'handoff'],
    summary: 'Hand a chat to the other agent (Claude to Codex or back) with its recent history',
    usage:
      'orca chat handoff [<id>] --to <codex|claude> [--message <text>] [--fresh] [--stop] [--focus] [--dry-run] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'to', 'message', 'fresh', 'stop', 'focus', 'dry-run'],
    positionalArgs: ['id'],
    notes: [
      ID_NOTE,
      'A new chat of the other agent starts in the same workspace. Its first message holds as much of the chat history as the budget allows (Settings > Blackfish > Chats > Chat handoff): the original request and the newest entries in full, never a summary. It reads older entries with `orca chat history`.',
      'Handing back to the agent the work came from continues that earlier chat with only what is new, while its context has room; otherwise, or with --fresh, a new chat starts.',
      '--message is what the new agent is asked to do (default: carry on); it is never shortened. A chat in the middle of a turn is refused unless --stop stops the turn first. --focus shows the new chat. --dry-run prints the message and starts nothing.',
      'The source chat stays open. If it waits to resume at a usage limit reset, that resume is cancelled so two agents do not take up the same work.'
    ],
    examples: [
      'orca chat handoff --to codex',
      'orca chat handoff 3f2a9c1e-... --to claude --message "Finish the migration and run the tests"',
      'orca chat handoff --to codex --dry-run'
    ]
  },
  {
    path: ['chat', 'history'],
    summary: "Read a chat's history by entry number, newest first, for a chat that took it over",
    usage: 'orca chat history [<id>] [--before <number>] [--limit <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'before', 'limit'],
    positionalArgs: ['id'],
    notes: [
      ID_NOTE,
      'Prints up to --limit entries (default 20, at most 50) numbered below --before, oldest of them first; without --before, the newest. Pass the number the output ends with to --before to read further back.',
      "Entries are the chat's requests and answers in full and one line per tool call or file edit. Reading never starts the chat's agent."
    ],
    examples: [
      'orca chat history 3f2a9c1e-... --before 812',
      'orca chat history 3f2a9c1e-... --before 813 --limit 1 --json'
    ]
  }
]
