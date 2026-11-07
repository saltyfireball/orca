// SLRM-1503: move one Claude chat, or a worktree's Claude chats, to another account of the host
// that runs them. Shared by the host's RPC methods, the desktop and the CLI.
import { z } from 'zod'

/** Set by a queued terminal restart; main turns it into that pane's own account pointer. */
export const FORK_CLAUDE_TERMINAL_ACCOUNT_ENV = 'ORCA_FORK_CLAUDE_ACCOUNT'
/** The value of `FORK_CLAUDE_TERMINAL_ACCOUNT_ENV`, and the CLI's account name, for System default. */
export const FORK_CLAUDE_SYSTEM_DEFAULT = 'system'

const Id = z.string().trim().min(1).max(512)

/** Exactly one of `sessionId` or `worktree` (a workspace id on that host); neither lists all chats. */
const Scope = z.object({ sessionId: Id.optional(), worktree: Id.optional() })

export const ForkClaudeAccountWhichParams = Scope.refine(
  (value) => !(value.sessionId && value.worktree),
  { message: 'Pass either a session or a worktree, not both' }
)

export const ForkClaudeAccountMoveParams = Scope.extend({
  /** Null is System default. */
  accountId: Id.nullable(),
  /** Stop a running turn instead of waiting for it to end. */
  now: z.boolean().optional()
}).refine((value) => Boolean(value.sessionId) !== Boolean(value.worktree), {
  message: 'Pass a session or a worktree'
})

export const ForkClaudeAccountCancelParams = z.object({ sessionId: Id })

export type ForkClaudeBusyActivity = 'turn' | 'question' | 'children'

/**
 * The folder the host last launched a chat's Claude under (else its founding home), in the host's
 * own path syntax. `accountId` is set when the host launched it on a managed account it named.
 */
export type ForkClaudeLaunchHome = {
  home: string | null
  accountId: string | null
}

export type ForkClaudeSessionAccount = {
  sessionId: string
  name: string
  workspaceId: string
  /** The machine that runs the chat. */
  host: string
  /** Where its next launch goes; null is System default. */
  accountId: string | null
  /** The account's email, or System default's when known. */
  accountLabel: string
  /** Where its live provider runs: null is System default, `undefined` none or unknown. */
  runningAccountId?: string | null
  /** Where it last launched; the account chip names a chat that has no pin by this folder. */
  launch: ForkClaudeLaunchHome
  /** True once moved: it no longer follows the account selection. */
  pinned: boolean
  /** A move is waiting for the live provider to finish what it is doing. */
  pending: boolean
  busy: ForkClaudeBusyActivity | null
}

export type ForkClaudeCantMoveReason =
  | 'not-found'
  | 'not-claude'
  | 'wsl-chat'
  | 'unknown-account'
  | 'history-not-shared'
  | 'account-setup-failed'
  | 'stop-failed'

export type ForkClaudeMoveStatus = 'moved' | 'queued' | 'unchanged' | 'cant-move'

export type ForkClaudeMoveResult = {
  sessionId: string
  name: string
  status: ForkClaudeMoveStatus
  reason?: ForkClaudeCantMoveReason
  /** What a queued move waits for. */
  busy?: ForkClaudeBusyActivity
  /** A running turn was stopped for `now`. */
  stopped?: true
}

export type ForkClaudeMoveResponse = {
  host: string
  accountId: string | null
  results: ForkClaudeMoveResult[]
}

export type ForkClaudeWhichResponse = {
  host: string
  sessions: ForkClaudeSessionAccount[]
}
