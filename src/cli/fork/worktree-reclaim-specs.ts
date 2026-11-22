// BAD-691 (FORK.md "Worktree reclaim"): `orca workspace reclaim`.
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

export const FORK_WORKTREE_RECLAIM_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['workspace', 'reclaim'],
    summary: 'Free disk in idle workspaces by removing their regenerable git-ignored files',
    usage:
      'orca workspace reclaim [--idle <3d|12h|90m>] [--repo <id|name>] [--worktree <id|path>] [--dry-run] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'idle', 'repo', 'worktree', 'dry-run'],
    notes: [
      'Deletes only paths that git lists as ignored and untracked and that match the reclaim list (node_modules, dist, build, .next, target, .venv, caches and similar). Tracked files, untracked files that are not ignored, .env files and anything else ignored are never touched, and the workspace, its branch and uncommitted work stay.',
      'Skips workspaces with a running agent, an open chat, a live terminal or on screen, workspaces active within --idle (default 3 days), the main checkout and workspaces Orca does not track.',
      'It is off until you turn it on: `orca settings set forkWorktreeReclaim true`. --dry-run always works and lists each path and its size per workspace. Other settings: forkWorktreeReclaimIdleDays and forkWorktreeReclaimPaths. A project can set its own list in orca.yaml under worktree: reclaim: [globs]; it replaces the default list.',
      'Run it against the host that owns the projects. The setup script in orca.yaml reinstalls what was removed the next time you use the workspace.'
    ],
    examples: [
      'orca workspace reclaim --dry-run',
      'orca workspace reclaim --idle 7d',
      'orca workspace reclaim --repo my-project --dry-run --json'
    ]
  }
]
