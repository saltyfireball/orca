// Limit resume (FORK.md, SLRM-2309): `orca limits`.
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

const HOST_NOTE =
  'Each host parks and resumes its own chats and terminal agents; add --environment to ask a paired server.'
const ID_NOTE =
  'An id is as `orca limits list` prints it (a pane key, or chat:<session id>); a unique prefix of 4+ characters is enough.'

export const FORK_LIMITS_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['limits', 'list'],
    summary: 'List chats and terminal agents stopped on a usage limit, with when each resumes',
    usage: 'orca limits list [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [HOST_NOTE],
    examples: ['orca limits list', 'orca limits list --json']
  },
  {
    path: ['limits', 'resume-now'],
    summary: 'Tell a parked chat or terminal agent to go on now, before its reset',
    usage: 'orca limits resume-now <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    positionalArgs: ['id'],
    notes: [
      ID_NOTE,
      'Nothing is sent while the agent is busy, a dialog is up or its message box holds text.',
      HOST_NOTE
    ],
    examples: ['orca limits resume-now chat:3f2a']
  },
  {
    path: ['limits', 'cancel'],
    summary: 'Do not resume this stop automatically; it waits for you',
    usage: 'orca limits cancel <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    positionalArgs: ['id'],
    notes: [ID_NOTE, HOST_NOTE],
    examples: ['orca limits cancel chat:3f2a']
  },
  {
    path: ['limits', 'usage'],
    summary:
      'Claude and Codex usage pooled across every account on this machine and its paired servers',
    usage: 'orca limits usage [--refresh] [--local] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'refresh', 'local'],
    notes: [
      'One line per provider and window (5-hour, weekly): the mean used across accounts, the next reset and how much of the pool it frees.',
      'An account signed in on several machines counts once. Machines send usage numbers only, never tokens.',
      '--refresh reads usage again first (slower); --local leaves out paired servers.'
    ],
    examples: ['orca limits usage', 'orca limits usage --refresh --json']
  }
]
