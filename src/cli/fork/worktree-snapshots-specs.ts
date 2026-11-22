// BAD-677 (FORK.md "Worktree snapshots"): `orca worktree snapshots|restore`.
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

export const FORK_WORKTREE_SNAPSHOT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['worktree', 'snapshots'],
    summary: 'List the snapshots Orca took before it removed worktrees that held work',
    usage: 'orca worktree snapshots [--repo <name|id|path>] [--prune] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo', 'prune'],
    notes: [
      'Before Orca removes a worktree with uncommitted, untracked (not ignored) or unpushed work, it saves the working tree as a commit under refs/orca/snapshots/<workspace>/<time> in the project. Clean, fully pushed worktrees are not snapshotted.',
      'Snapshots stay on this machine (refs/orca is never pushed) and are pruned after the retention period. --prune deletes the expired ones now.',
      'Settings forkWorktreeSnapshots (on by default) and forkWorktreeSnapshotRetentionDays (14 by default), set with `orca settings`.'
    ],
    examples: ['orca worktree snapshots', 'orca worktree snapshots --repo orca --json']
  },
  {
    path: ['worktree', 'restore'],
    summary: 'Recreate a removed worktree, with its branch and uncommitted files, from a snapshot',
    usage: 'orca worktree restore <id> [--repo <name|id|path>] [--path <folder>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'repo', 'path'],
    positionalArgs: ['id'],
    notes: [
      'The id is the one `orca worktree snapshots` prints. The worktree comes back at its old path (or --path) on its branch at the commit it had; changes show as uncommitted and new files as untracked.',
      'If the branch now exists at another commit, the worktree is put on <branch>-restored-<time> instead. A path that already exists is refused.',
      'Orca lists the restored worktree the next time it refreshes the project.'
    ],
    examples: ['orca worktree restore my-feature/1766400000000']
  }
]
