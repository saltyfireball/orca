// Pause all (BAD-685, FORK.md "Pause all"): `orca pause-all`, `orca resume-all`, `orca pause-status`.
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

const NOTE =
  'While paused, nothing unattended starts: scheduled and event automations (run history says why), idle-recovery wakes, PR babysitter and nudge sends and merges, limit and unattended resume, goal steps, worker retries and worker launches (a terminal worker-start is refused, and a restart offers its terminal workers instead of continuing them). Turns already running finish; a person\'s own chats, "Run now" and sends are never blocked. A switch that cannot be read counts as paused. By default every paired server is changed too and the ones that could not be reached are listed (Settings > Blackfish, `forkPauseAllPairedServers`).'

export const FORK_PAUSE_ALL_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['pause-all'],
    summary: 'Stop every unattended feature from starting new work here and on paired servers',
    usage: 'orca pause-all [--hosts all|local] [--note <text>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'hosts', 'note'],
    notes: [NOTE, 'Undo it with `orca resume-all`.'],
    examples: ['orca pause-all', 'orca pause-all --hosts local --note "migration window"']
  },
  {
    path: ['resume-all'],
    summary: 'Release pause-all: unattended features start new work again',
    usage: 'orca resume-all [--hosts all|local] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'hosts'],
    notes: [
      'Releases the switch here and on paired servers, and clears a switch that could not be read. Work held while paused (due restarts, queued worker launches, parked chats) starts on the next check, and terminal workers a restart held as offers are resumed once.'
    ],
    examples: ['orca resume-all']
  },
  {
    path: ['pause-status'],
    summary: 'Show whether pause-all is engaged here and on every paired server',
    usage: 'orca pause-status [--hosts all|local] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'hosts'],
    examples: ['orca pause-status']
  }
]
