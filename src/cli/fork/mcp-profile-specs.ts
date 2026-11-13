// FORK.md "MCP profiles": `orca mcp-profile list|show|set`, and --mcp-profile on the
// commands that start agents.
import { GLOBAL_FLAGS, type CommandSpec } from '../args'

export const FORK_MCP_PROFILE_FLAG = 'mcp-profile'

export const FORK_MCP_PROFILE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['mcp-profile', 'list'],
    summary: 'List the MCP servers Claude would load, and the MCP profiles',
    usage: 'orca mcp-profile list [--folder <path>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'folder'],
    notes: [
      'Reads Claude Code config the way Claude does: user servers, local servers for the folder, and approved .mcp.json servers from the folder up. Nothing is changed.',
      'Without --folder only user servers are listed. Server env, headers and arguments are never shown.',
      'Profiles are set in Settings > Advanced > MCP profiles. "all" (every server, as stock) and "none" are built in.',
      'Profiles apply to Claude chats only. Terminal agents, Codex and other agents load their servers as usual.'
    ],
    examples: ['orca mcp-profile list', 'orca mcp-profile list --folder /projects/myapp --json']
  },
  {
    path: ['mcp-profile', 'show'],
    summary: "Show a chat's MCP profile and the servers it started with",
    usage: 'orca mcp-profile show <session-id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'session'],
    positionalArgs: ['session'],
    examples: ['orca mcp-profile show 0b4f2c1e-...']
  },
  {
    path: ['mcp-profile', 'set'],
    summary: "Choose a chat's MCP profile; it applies on the chat's next start",
    usage: 'orca mcp-profile set <session-id> <profile|default> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'session', 'profile'],
    positionalArgs: ['session', 'profile'],
    notes: [
      'A running chat keeps its servers until it next starts (after it sleeps, the app restarts, or it is resumed).',
      '"default" drops the chat\'s own choice so the project and launch defaults decide again.'
    ],
    examples: [
      'orca mcp-profile set 0b4f2c1e-... none',
      'orca mcp-profile set 0b4f2c1e-... default'
    ]
  }
]

const LAUNCH_PATHS = ['agent launch', 'worktree create', 'orchestration worker-start']

const FLAG_NOTE =
  '--mcp-profile <name> picks the MCP profile a Claude chat starts with (see `orca mcp-profile list`). An unknown name is refused; a terminal launch or another agent ignores it.'

/** Adds --mcp-profile to the commands that start agents; one hook on the spec list. */
export function withForkMcpProfileFlag(specs: CommandSpec[]): CommandSpec[] {
  return specs.map((spec) =>
    LAUNCH_PATHS.includes(spec.path.join(' '))
      ? {
          ...spec,
          usage: spec.usage.replace(/ \[--json\]$/, ' [--mcp-profile <name>] [--json]'),
          allowedFlags: [...spec.allowedFlags, FORK_MCP_PROFILE_FLAG],
          notes: [...(spec.notes ?? []), FLAG_NOTE]
        }
      : spec
  )
}
