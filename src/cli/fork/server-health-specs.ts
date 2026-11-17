// SLRM-2311 (FORK.md "Server health"): `orca servers health`.
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

export const FORK_SERVER_HEALTH_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['servers', 'health'],
    summary: 'Show whether each paired remote server answers, and when it was last seen',
    usage: 'orca servers health [--environment <name>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'The desktop app watches the servers it holds a connection to; a server it is not connected to shows as not watched. Last seen times start when the app starts.',
      'An offline alert goes out after `forkServerHealthOfflineMinutes` (5) without an answer, and a back alert once it has answered for `forkServerHealthRecoverySeconds` (60), to the Decision inbox notification targets.',
      "The last line is this host's own heartbeat to its outside address (`forkServerHeartbeatUrl`, off by default). With --environment it is the server's."
    ],
    examples: [
      'orca servers health',
      'orca servers health --json',
      'orca servers health --environment build-box'
    ]
  }
]
