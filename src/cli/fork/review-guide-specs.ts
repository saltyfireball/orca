// Review guides (FORK.md, SLRM-2396): `orca review-guide`. `write` and `cancel` come first, so
// their words are never read as the bare command's pull request.
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

const TARGET_FLAGS = ['pr', 'worktree', 'repo']
const TARGET_NOTE =
  '<pr> is a number, #number or the pull request URL (a URL also names its repository). Without --worktree or --repo it uses the workspace of the current folder; the guide is written on the machine that holds that checkout.'

export const FORK_REVIEW_GUIDE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['review-guide', 'write'],
    summary: 'Have an agent write a review guide for a pull request (uses agent usage)',
    usage:
      'orca review-guide write <pr> [--worktree <selector>|--repo <id|name>] [--wait] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, ...TARGET_FLAGS, 'wait'],
    positionalArgs: ['pr'],
    notes: [
      TARGET_NOTE,
      'The writer is the source control "pull request" model from Settings. It reads the pull request from GitHub and writes stops in reading order, "look closely" marks and mechanical changes at the end.',
      'Without --wait it starts the write and returns; --wait prints the guide when it is done.'
    ],
    examples: [
      'orca review-guide write 42 --wait',
      'orca review-guide write https://github.com/o/r/pull/42'
    ]
  },
  {
    path: ['review-guide', 'cancel'],
    summary: 'Stop writing a review guide',
    usage: 'orca review-guide cancel <pr> [--worktree <selector>|--repo <id|name>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, ...TARGET_FLAGS],
    positionalArgs: ['pr'],
    notes: [TARGET_NOTE],
    examples: ['orca review-guide cancel 42']
  },
  {
    path: ['review-guide'],
    summary: 'Print the review guide of a pull request: stops in reading order, look-closely marks',
    usage: 'orca review-guide <pr> [--worktree <selector>|--repo <id|name>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, ...TARGET_FLAGS],
    positionalArgs: ['pr'],
    notes: [
      TARGET_NOTE,
      'Reading a guide costs nothing; a pull request without one says so. `orca review-guide write <pr>` writes one.',
      'Marking files viewed on GitHub is done in the Guide tab, one click per stop; this command never marks anything.'
    ],
    examples: ['orca review-guide 42', 'orca review-guide 42 --repo my-project --json']
  }
]
