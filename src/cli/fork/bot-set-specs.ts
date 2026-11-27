// BAD-635 (FORK.md "Bot model from the CLI"): `orca bot set`.
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

export const FORK_BOT_SET_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['bot', 'set'],
    summary: "Set the model and effort a bot's new chats start on, for one bot or all of them",
    usage:
      'orca bot set (--bot <name> [--agent <agent>] | --all [--agent <agent>]) [--model <id>] [--effort <level>] [--clear] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'bot', 'all', 'agent', 'model', 'effort', 'clear'],
    notes: [
      "The same choice as the model and effort in a bot's settings: saved on the bot (bots.update), used by every new chat it starts. Chats already open keep theirs.",
      '--bot takes a name (any case) or id; --all sets every bot on the host, and --agent limits it to bots of one agent. A model belongs to its agent, so --all --model needs every chosen bot on one agent.',
      '--effort alone keeps the bot model; a new --model without --effort drops the old effort. --clear removes the choice, so its chats start on the native chat defaults (the last model picked in any chat).',
      'With --environment it sets the bots of that paired server. New bots start on the "bot" row of Settings > Blackfish > Launch defaults when it is set.',
      'BAD-873: with --bot, --agent moves the bot to that agent (its new chats start there, and its Home chat is replaced). It takes a bot agent id or the name of a custom ACP agent from `orca agent custom list`; a custom agent picks its own model, so it takes no --model or --effort.'
    ],
    examples: [
      'orca bot set --bot Dispatcher --model haiku',
      'orca bot set --bot Lantern --agent pebble',
      'orca bot set --all --model claude-opus-5-5 --effort medium',
      'orca bot set --all --clear --environment work-server'
    ]
  }
]
