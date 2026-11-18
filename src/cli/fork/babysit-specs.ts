// PR babysitter (FORK.md, SLRM-2386): `orca babysit`. `list` and `stop` come first, so their words
// are never read as the bare command's pull request.
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

const HOST_NOTE =
  'Each host babysits the chats that run on it: use --environment for a chat on a paired server.'
const PR_NOTE =
  'A pull request is its URL, owner/repo#12 or host/owner/repo#12 (owner/repo means github.com).'

export const FORK_BABYSIT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['babysit', 'list'],
    aliases: [['babysit', 'ls']],
    summary: 'List babysat pull requests with what the babysitter is doing for each',
    usage: 'orca babysit list [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [HOST_NOTE],
    examples: ['orca babysit list', 'orca babysit list --json']
  },
  {
    path: ['babysit', 'stop'],
    summary: 'Stop babysitting one pull request',
    usage: 'orca babysit stop <pr> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'pr'],
    positionalArgs: ['pr'],
    notes: ['It also overrides the Settings repo list for that pull request.', PR_NOTE, HOST_NOTE],
    examples: ['orca babysit stop acme/api#12']
  },
  {
    path: ['babysit'],
    summary:
      'Babysit a pull request: send its chat fix requests when CI fails, merge on green when allowed',
    usage: 'orca babysit <pr> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'pr'],
    positionalArgs: ['pr'],
    notes: [
      'When CI fails, the chat that opened or pushed to the pull request gets one fix request with the failing log excerpts, up to forkPrBabysitMaxRounds (3) in a row. It then waits for the next CI result.',
      'Green starts the count over. With forkPrBabysitAutoMerge on it merges once every check is green, no change is requested and GitHub reports the merge clean, with the repository merge method and never with admin rights.',
      'When it cannot go on it stops and the pull request joins the Decision inbox (orca inbox list).',
      'Running it again on a stopped pull request starts it over with fresh rounds.',
      PR_NOTE,
      HOST_NOTE
    ],
    examples: [
      'orca babysit https://github.com/acme/api/pull/12',
      'orca babysit acme/api#12 --environment build-box'
    ]
  }
]
