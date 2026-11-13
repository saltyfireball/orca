// SLRM-2098 (FORK.md "Agent launch queue"): `orca agent queue list|start|cancel`.
import { GLOBAL_FLAGS, type CommandSpec } from '../args'

export const FORK_AGENT_QUEUE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['agent', 'queue', 'list'],
    summary: 'List agent launches waiting for a free slot',
    usage: 'orca agent queue list [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'With the agent limit on (Settings > Advanced), launches past the limit wait here and start in order when a running agent stops: user-started launches first, then orchestration workers.',
      'With --environment or --pairing-code it reads that host; each host has its own queue.'
    ],
    examples: ['orca agent queue list', 'orca agent queue list --json']
  },
  {
    path: ['agent', 'queue', 'start'],
    summary: 'Start a queued agent launch now, past the limit',
    usage: 'orca agent queue start <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    positionalArgs: ['id'],
    examples: ['orca agent queue start 1a2b3c4d']
  },
  {
    path: ['agent', 'queue', 'cancel'],
    summary: 'Cancel a queued agent launch',
    usage: 'orca agent queue cancel <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    positionalArgs: ['id'],
    notes: [
      'The chat stays open; the message it was waiting to send shows as not sent. Sending to it again queues it again.'
    ],
    examples: ['orca agent queue cancel 1a2b3c4d']
  }
]
