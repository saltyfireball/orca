// SLRM-1503 (FORK.md): `orca account which` and `orca account move`.
import { GLOBAL_FLAGS, type CommandSpec } from '../args'

export const FORK_ACCOUNT_MOVE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['account', 'which'],
    summary: 'Show which Claude account each chat on an Orca host runs on',
    usage: 'orca account which [--session <id> | --worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'session', 'worktree'],
    notes: [
      'Lists the native Claude chats shown or running on the host: their account for the next launch, the account their running provider uses, and whether a move is waiting for a turn to end.',
      'With --environment or --pairing-code it reads that host; each host has its own accounts.'
    ],
    examples: [
      'orca account which',
      'orca account which --worktree active',
      'orca account which --environment devbox --json'
    ]
  },
  {
    path: ['account', 'move'],
    summary: 'Move one Claude chat, or every Claude chat in a worktree, to another account',
    usage:
      'orca account move <id|email|system> (--session <id> | --worktree <selector>) [--now] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'account', 'session', 'worktree', 'now'],
    positionalArgs: ['account'],
    notes: [
      'Only the named chats move; every other chat keeps the account it follows. The conversation resumes on the new account at its next message.',
      'A chat in the middle of a turn is never cut off: its move waits for the turn to end. --now stops the turn instead.',
      "The account is an id or email of one of that host's Claude accounts, or `system`. Run inside a chat, --session defaults to that chat.",
      "With --environment or --pairing-code it moves that host's chats only."
    ],
    examples: [
      'orca account move me@work.example --session <sessionId>',
      'orca account move system --worktree active --now',
      'orca account move <accountId> --worktree <selector> --environment devbox --json'
    ]
  }
]
