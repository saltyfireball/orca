// FORK.md "Agent profiles": `orca profiles ...`, and --profile on the commands that start agents.
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

export const FORK_AGENT_PROFILE_FLAG = 'profile'

export const FORK_AGENT_PROFILE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['profiles', 'list'],
    summary: 'List the agent profiles: named launch bundles with a note on when to use each',
    usage: 'orca profiles list [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'A profile bundles an agent, model, effort, permission mode, MCP profile, account, a preamble and a when-to-use note. Start one with --profile <name> on `orca agent launch`, `orca worktree create`, `orca orchestration worker-start` and `orca automations create`.',
      'Each host lists its own profiles; a coordinator reads the catalog to pick a worker.'
    ],
    examples: ['orca profiles list', 'orca profiles list --json']
  },
  {
    path: ['profiles', 'show'],
    summary: 'Show one agent profile, including its full preamble',
    usage: 'orca profiles show <name> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'name'],
    positionalArgs: ['name'],
    examples: ['orca profiles show reviewer']
  },
  {
    path: ['profiles', 'set'],
    summary: 'Create or change an agent profile',
    usage:
      'orca profiles set <name> [--agent <agent>] [--model <id>] [--effort <level>] [--permission-mode ask|accept-edits|auto|full-access] [--mcp-profile <name>] [--account <account>] [--preamble <text>|--preamble-file <path>] [--when-to-use <text>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'name',
      'agent',
      'model',
      'effort',
      'permission-mode',
      'mcp-profile',
      'account',
      'preamble',
      'preamble-file',
      'when-to-use'
    ],
    positionalArgs: ['name'],
    notes: [
      'A new profile needs --agent. Flags not given keep the profile\'s current value; pass an empty value (--model "") to clear one.',
      "The permission mode is capped by Settings: the agent's permission in Settings > Agents when it sets one, else Settings > Blackfish > Agent profiles (default accept-edits). A wider mode is lowered at launch.",
      'The account is recorded and shown; launches use the account selected with `orca account select`.'
    ],
    examples: [
      'orca profiles set reviewer --agent claude --model opus --effort high --when-to-use "Read-only review of a diff"',
      'orca profiles set lookup --agent claude --model haiku --when-to-use "Quick lookups and searches"'
    ]
  },
  {
    path: ['profiles', 'remove'],
    summary: 'Remove an agent profile',
    usage: 'orca profiles remove <name> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'name'],
    positionalArgs: ['name'],
    examples: ['orca profiles remove reviewer']
  },
  {
    path: ['profiles', 'import'],
    summary: 'Import agent definitions from .claude/agents, .codex/agents or .agents/agents',
    usage: 'orca profiles import [<file-or-folder>] [--agent <agent>] [--name <name>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'path', 'agent', 'name'],
    positionalArgs: ['path'],
    notes: [
      'With no path it reads the three folders in the current directory and in your home directory. A path is one definition file or a folder of them.',
      "The file's prompt becomes the profile's preamble and its description the when-to-use note. Markdown files need frontmatter or a body; Codex files are TOML.",
      'An imported preamble is shown by `orca profiles show` and is not used until you run `orca profiles confirm <name>`. Editing it asks again.',
      'Existing profiles with the same name are left alone.'
    ],
    examples: ['orca profiles import', 'orca profiles import .claude/agents/reviewer.md']
  },
  {
    path: ['profiles', 'confirm'],
    summary: "Confirm an imported profile's preamble so launches may use it",
    usage: 'orca profiles confirm <name> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'name'],
    positionalArgs: ['name'],
    examples: ['orca profiles confirm reviewer']
  }
]

const LAUNCH_PATHS = [
  'agent launch',
  'worktree create',
  'orchestration worker-start',
  'automations create'
]

const FLAG_NOTE =
  '--profile <name> starts from an agent profile (see `orca profiles list`): its agent, model, effort and MCP profile fill whatever you did not pass, and its preamble goes in front of the prompt or spec. Explicit flags win.'

/** Adds --profile to the commands that start agents; one hook on the spec list. */
export function withForkAgentProfileFlag(specs: CommandSpec[]): CommandSpec[] {
  return specs.map((spec) =>
    LAUNCH_PATHS.includes(spec.path.join(' '))
      ? {
          ...spec,
          usage: spec.usage.replace(/ \[--json\]$/, ' [--profile <name>] [--json]'),
          allowedFlags: [...spec.allowedFlags, FORK_AGENT_PROFILE_FLAG],
          notes: [...(spec.notes ?? []), FLAG_NOTE]
        }
      : spec
  )
}
