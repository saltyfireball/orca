// Server updates (FORK.md, SLRM-2310): `orca servers list|update|rollback`.
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

const DESKTOP_NOTE =
  'It runs on this desktop, which asks each paired server over its own connection (no SSH); run it without --environment.'

export const FORK_SERVERS_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['servers', 'list'],
    aliases: [['servers', 'ls']],
    summary: "List paired servers with their version and whether each is behind this desktop's",
    usage: 'orca servers list [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [DESKTOP_NOTE],
    examples: ['orca servers list', 'orca servers list --json']
  },
  {
    path: ['servers', 'update'],
    summary: "Update paired servers to this desktop's version, one at a time",
    usage:
      'orca servers update (--all | <name>...) [--version <x.y.z>] [--now] [--wait <minutes>] [--allow-downgrade] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'server', 'all', 'version', 'now', 'wait', 'allow-downgrade'],
    positionalArgs: ['server'],
    variadicPositional: true,
    repeatableFlags: ['server'],
    notes: [
      'Each server downloads the matching Blackfish app (macOS) or server tarball (Linux) from its own release address setting, checks its checksum and, on macOS, its signing certificate, then waits until no turn runs there (--wait, default its own setting, 30 minutes), restarts its service and reports its new version.',
      'The old version is kept beside the new one: if the new one does not come up in time it is put back, and `orca servers rollback <name>` puts it back by hand.',
      '--now restarts without waiting for running turns. A server never goes to an older version without --allow-downgrade.',
      'A server that fails or does not answer is reported and the rest go on.',
      DESKTOP_NOTE
    ],
    examples: [
      'orca servers update --all',
      'orca servers update m2mac kif',
      'orca servers update kif --now',
      'orca servers update --all --version 1.4.261002'
    ]
  },
  {
    path: ['servers', 'rollback'],
    summary: 'Put back the version a paired server ran before its last update',
    usage: 'orca servers rollback <name> [--now] [--wait <minutes>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'server', 'now', 'wait'],
    positionalArgs: ['server'],
    notes: [
      'The server swaps its install with the one it kept, waits for running turns unless --now, and restarts.',
      DESKTOP_NOTE
    ],
    examples: ['orca servers rollback kif']
  }
]
