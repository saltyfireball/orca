// BAD-669 (FORK.md "Worker archive"): `orca orchestration worker-cleanup`.
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'
import type { CommandSpec } from '../discovery/command-spec'

export const FORK_WORKER_CLEANUP_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['orchestration', 'worker-cleanup'],
    summary: 'Remove the workspaces of finished workers that hold no unmerged or uncommitted work',
    usage:
      'orca orchestration worker-cleanup [--bot <name>] [--dry-run] [--include-remote] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'bot', 'dry-run', 'include-remote'],
    notes: [
      'Acts on workspaces a worker start created (--worktree new-child or new-top-level) whose worker finished. It never touches a workspace a worker did not create, a bot home or a workspace you own.',
      'A workspace is removed like `orca worktree rm`: terminals stopped, checkout removed, the git branch kept. One that is kept open, pinned, in use, running, has uncommitted or untracked changes, or has commits on no base branch is listed with the reason and left alone.',
      'The automatic archive does the same on a timer once the delay in Settings > Blackfish has passed; this command acts now and waives the delay.',
      '--dry-run lists what would be removed and what is skipped, and removes nothing.',
      '--bot limits it to the workers a bot started (its name or id).',
      '--include-remote also asks every paired server to clean up its own workspaces.'
    ],
    examples: [
      'orca orchestration worker-cleanup --dry-run',
      'orca orchestration worker-cleanup --bot cassandra',
      'orca orchestration worker-cleanup --include-remote --dry-run --json'
    ]
  },
  {
    path: ['bot', 'chats-cleanup'],
    summary:
      'Close the bot chats that are finished: their card is done, they reported back, or they sat idle too long',
    usage: 'orca bot chats-cleanup [--bot <name>] [--dry-run] [--include-remote] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'bot', 'dry-run', 'include-remote'],
    notes: [
      "Closes a chat like Close chat in the sidebar: its history stays in the bot's Chats tab. Never a Home Chat, a chat that is running, queued or waiting on you, or one you typed into within the idle window.",
      'A chat closes when its card (a key such as ABC-12 in the title) is Done or Canceled, when a chat Orca started finished and reported back, or when it has been idle longer than forkBotChatAutoCloseIdleHours (24). The automatic pass does the same on a timer; this command runs it now.',
      '--dry-run lists what would close and why, and closes nothing.',
      '--bot limits it to one bot (its name or id).',
      "--include-remote also asks every paired server to close its own bots' chats."
    ],
    examples: [
      'orca bot chats-cleanup --dry-run',
      'orca bot chats-cleanup --bot builder',
      'orca bot chats-cleanup --include-remote --dry-run --json'
    ]
  }
]
