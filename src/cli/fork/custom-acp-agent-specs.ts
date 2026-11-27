// BAD-873 (FORK.md "Custom ACP agents"): `orca agent custom add|list|remove`.
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

export const FORK_CUSTOM_ACP_AGENT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['agent', 'custom', 'add'],
    summary: 'Save a custom ACP agent: a program that speaks the Agent Client Protocol over stdio',
    usage:
      'orca agent custom add <name> --command <program> [--arg <arg>]... [--args-json <json>] [--cwd <folder>] [--env <NAME>]... [--env-file <path>] [--owns-prompt] [--replace] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'name',
      'command',
      'arg',
      'args-json',
      'cwd',
      'env',
      'env-file',
      'owns-prompt',
      'replace'
    ],
    positionalArgs: ['name'],
    repeatableFlags: ['arg', 'env'],
    booleanFlags: ['owns-prompt', 'replace'],
    notes: [
      'The name is what `orca agent launch --agent`, `orca bot set --agent` and the new-chat menu take: lowercase letters, digits and dashes, and not a built-in agent id.',
      '--command is an absolute path or a program on PATH; each --arg adds one argument, in order (write --arg=--flag for one that starts with --, or give them all as --args-json \'["--flag","x"]\'). --cwd is the absolute folder it starts in; without it, it starts in the chat\'s folder.',
      "--env NAME passes the variable NAME with the value it has in this shell; --env-file reads NAME=VALUE lines. Values are kept in a private file on the host and reach only the agent's own environment, never settings, logs or its command line. A NAME=VALUE on the command line is refused. PATH, HOME and ORCA_* are Orca's.",
      "--owns-prompt: the agent keeps its own persona, so a bot on it gets no SOUL.md or MEMORY.md, only Orca's bot rules as context. Without it, a bot chat needs the agent to take Orca's standing instructions (docs/fork/custom-acp-agents.md).",
      'A taken name is refused unless --replace, which replaces the whole definition and its env values.'
    ],
    examples: [
      'orca agent custom add pebble --command /usr/bin/python3 --arg -m --arg pebble_acp --env PYTHONPATH --owns-prompt',
      'orca agent custom add lantern --command lantern-acp --args-json \'["--stdio"]\' --env-file ~/.config/lantern/acp.env'
    ]
  },
  {
    path: ['agent', 'custom', 'list'],
    summary: 'List the custom ACP agents saved on the host',
    usage: 'orca agent custom list [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: ["Shows each agent's program, arguments, folder and env names, never their values."],
    examples: ['orca agent custom list']
  },
  {
    path: ['agent', 'custom', 'remove'],
    summary: 'Remove a custom ACP agent and its saved env values',
    usage: 'orca agent custom remove <name> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'name'],
    positionalArgs: ['name'],
    notes: [
      'Chats on it stay in history and say so if started again. Its private folder on the host is kept, so adding it again finds what it kept there.'
    ],
    examples: ['orca agent custom remove pebble']
  }
]
