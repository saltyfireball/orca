// BAD-678 (FORK.md "Turn checkpoints"): `orca checkpoint list|diff|restore|undo`.
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

const SHADOW_NOTE =
  "Orca saves the workspace files into a private shadow git store in its data folder at the end of each agent turn (terminal agents and chats alike), when they changed. The project's own .git is never touched; ignored files (.env) and files over the size cap are left out."

export const FORK_TURN_CHECKPOINT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['checkpoint', 'list'],
    summary: 'List the file checkpoints Orca took at the end of agent turns, newest first',
    usage: 'orca checkpoint list [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree'],
    notes: [
      SHADOW_NOTE,
      'Settings forkTurnCheckpoints (on by default), forkTurnCheckpointMaxFileMb (5), forkTurnCheckpointKeep (50) and forkTurnCheckpointRetentionDays (7), set with `orca settings`.'
    ],
    examples: ['orca checkpoint list', 'orca checkpoint list --worktree active --json']
  },
  {
    path: ['checkpoint', 'diff'],
    summary: 'Show what one turn changed, or how the files differ from a checkpoint now',
    usage: 'orca checkpoint diff <id> [--now] [--patch] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'now', 'patch', 'worktree'],
    positionalArgs: ['id'],
    notes: [
      'Without --now the files are those the turn changed against the checkpoint before it; files a merge, pull or checkout brought in are left out and counted.',
      '--now compares the checkpoint with the files as they are on disk, which is what a restore would change.',
      '--patch also prints the patch text.'
    ],
    examples: ['orca checkpoint diff 1766400000000 --patch']
  },
  {
    path: ['checkpoint', 'restore'],
    summary: 'Put the workspace files back to a checkpoint (tracked and untracked, not ignored)',
    usage: 'orca checkpoint restore <id> [--force] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'force', 'worktree'],
    positionalArgs: ['id'],
    notes: [
      'A checkpoint of the files as they are is taken first, so the restore can be undone with `orca checkpoint undo`.',
      'Refused while another agent is working in the same directory; --force restores anyway.',
      'Files the checkpoint lacks are deleted; ignored files and files over the size cap are never touched.'
    ],
    examples: ['orca checkpoint restore 1766400000000']
  },
  {
    path: ['checkpoint', 'undo'],
    summary: 'Reverse the latest checkpoint restore; run again to put it back',
    usage: 'orca checkpoint undo [--force] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'force', 'worktree'],
    notes: [
      'Restores the checkpoint taken just before the latest restore. Same refusal and --force as restore.'
    ],
    examples: ['orca checkpoint undo']
  }
]
