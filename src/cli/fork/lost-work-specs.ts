// SLRM-2096 (FORK.md "Lost work"): `orca lost-work`.
import { GLOBAL_FLAGS, type CommandSpec } from '../args'

export const FORK_LOST_WORK_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['lost-work'],
    summary: 'List unmerged, finished or forgotten work across worktrees, branches and stashes',
    usage: 'orca lost-work [--repo <id|name>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo'],
    notes: [
      'Read-only: nothing is fetched, pushed or removed. It compares each item with the remote copy of the default branch as last fetched.',
      'Each item has a risk: safe to remove, needs a look, or would lose work (commits that are on no remote, uncommitted changes, or a stash).',
      'Squash merges are found by patch id, and by pull request state when the GitHub CLI is installed and signed in.',
      'The checks it runs and each project default branch are set in Settings > Advanced > Lost work.'
    ],
    examples: ['orca lost-work', 'orca lost-work --repo my-project', 'orca lost-work --json']
  }
]
