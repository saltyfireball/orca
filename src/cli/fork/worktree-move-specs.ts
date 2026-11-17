// SLRM-2265 (FORK.md "Worktree move"): `orca worktree move`.
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

export const FORK_WORKTREE_MOVE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['worktree', 'move'],
    summary: 'Move a workspace and its chats to another host',
    usage:
      'orca worktree move --to <host> [--worktree <selector>] [--stop-turns] [--dry-run] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'to', 'worktree', 'stop-turns', 'dry-run'],
    notes: [
      '--to takes local, runtime:<environment-id> or a paired Orca server name from `orca host list`. SSH hosts are not served by a runtime here; pair the machine as an Orca server instead.',
      'Without --worktree it moves the workspace of the current folder. The source host is the Orca this command talks to (--environment picks another).',
      'Nothing is committed: uncommitted changes travel as a patch and stay on the source too. The branch is pushed, the target checks it out, and each Claude or Codex chat is copied with its paths rewritten and reopened there with its history.',
      'A chat mid-turn stops the move unless --stop-turns is given. The source workspace is marked as moved and never deleted; remove it yourself when you are done with it.',
      'What a move does (push, patch, chats, home rewrite, the moved mark) is set in Settings > Blackfish > Projects > Move to host.'
    ],
    examples: [
      'orca worktree move --to runtime:abc123',
      'orca worktree move --to my-server --worktree path:/work/repo-feature --stop-turns',
      'orca worktree move --to local --dry-run --json'
    ]
  }
]
