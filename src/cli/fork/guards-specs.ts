// Agent guards (FORK.md, SLRM-2385): `orca guards`.
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

const HOST_NOTE =
  'Each host guards its own chats and terminal agents; add --environment to ask a paired server.'
const ID_NOTE =
  'An id is as `orca guards list` prints it (a chat session id or a terminal pane key); a unique prefix of 4+ characters is enough.'

export const FORK_GUARDS_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['guards', 'list'],
    summary: 'List agents a guard warned or paused, and chats with a spend cap',
    usage: 'orca guards list [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'The failure-loop guard warns an agent that repeats the same failing tool call, then pauses it if the call fails again.',
      'The spend cap pauses a chat at the end of the turn that took its estimated spend past its cap.',
      HOST_NOTE
    ],
    examples: ['orca guards list', 'orca guards list --json']
  },
  {
    path: ['guards', 'resume'],
    summary: 'Lift a guard pause; a chat spends against its cap again from now',
    usage: 'orca guards resume <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    positionalArgs: ['id'],
    notes: [
      ID_NOTE,
      'Messages the interrupt held follow the Stop button: they go after your next message.',
      HOST_NOTE
    ],
    examples: ['orca guards resume 3f2a9c']
  },
  {
    path: ['guards', 'cap'],
    summary: 'Set one chat its own spend cap in USD (0 goes back to the default)',
    usage: 'orca guards cap <id> <usd> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'usd'],
    positionalArgs: ['id', 'usd'],
    notes: [
      'Per dispatch: a coordinator caps a worker with the session id worker-start printed.',
      'Spend is estimated from the usage ledger at per-token prices (Settings > Blackfish > Usage report), counted from when the cap is set. Native Claude chats only.',
      HOST_NOTE
    ],
    examples: ['orca guards cap 3f2a9c 5', 'orca guards cap 3f2a9c 0']
  }
]
