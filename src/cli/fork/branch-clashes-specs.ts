// Branch clashes (FORK.md, SLRM-2394): `orca clashes`.
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

export const FORK_BRANCH_CLASHES_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['clashes'],
    summary: 'List files that more than one unmerged worktree branch changes, and stale branches',
    usage: 'orca clashes [--project <name|id>] [--refresh] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'project', 'refresh'],
    notes: [
      'Read-only: nothing is fetched. Each branch is compared with the default branch as last fetched, committed and (by default) uncommitted changes.',
      'This machine and every paired server report their own worktrees; one project matches across hosts by its remote address.',
      'A shared file is a hint, not proof of a merge conflict. Branches far behind the default branch are listed too.',
      'Without --refresh it answers from the last check when that is newer than the check interval. Settings > Blackfish > Projects > Branch clashes.'
    ],
    examples: ['orca clashes', 'orca clashes --project orca', 'orca clashes --refresh --json']
  }
]
