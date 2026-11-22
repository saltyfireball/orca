// Owner token (BAD-737, FORK.md): `orca bot item answer`.
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

export const FORK_BOT_ITEM_ANSWER_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['bot', 'item', 'answer'],
    summary: "Answer or comment on a bot's item as its owner, with the owner token",
    usage:
      'orca bot item answer <id> --text <text> [--question <eN>] [--plain] [--bot <name>] [--request-id <id>] [--owner-token-file <path>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'id',
      'text',
      'text-file',
      'question',
      'plain',
      'bot',
      'request-id',
      'owner-token-file'
    ],
    booleanFlags: ['plain'],
    positionalArgs: ['id'],
    notes: [
      'For a tool that acts for the owner outside Orca, such as an MCP server: it needs no bot chat or terminal, only the owner token. Your owner mints it in Settings > Blackfish > Owner token; none exists until then, and Revoke or a new mint ends the old one.',
      'The token comes from --owner-token-file (a file only its owner can read, mode 600) or ORCA_OWNER_TOKEN. It allows this command only; every other owner action stays in Orca.',
      "It is the owner's own comment, as in the item's thread in Orca: on a Needs you item it answers the bot's question, moves the item to In progress and wakes the bot. --question e12 answers that question only (refused if the bot has asked another since); --plain comments without answering. The comment ends with a line saying it came by owner token.",
      '--bot <name> refuses an item of any other bot. --request-id makes a retry return the comment already made.'
    ],
    examples: [
      'orca bot item answer 12 --text "Merge now" --bot Writer --owner-token-file ~/.config/orca-mcp/owner-token --json'
    ]
  }
]
