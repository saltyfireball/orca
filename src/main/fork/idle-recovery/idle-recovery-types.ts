// Idle recovery (FORK.md): the shapes the main-process pieces hand each other. Kept in one file
// so the candidate reader, the classifier runner and the sweep are built against it and not
// against each other.
import type {
  IdleRecoveryChatKind,
  IdleRecoveryRequestSource,
  IdleRecoveryRole
} from '../../../shared/fork/idle-recovery'
import type { ForkIdleRecoveryInboxItem } from '../../../shared/fork/idle-recovery-wire'

/** One chat whose turn has ended and that has sat idle past the idle window. */
export type IdleRecoveryCandidate = {
  /** A native chat session id or a terminal agent pane key. */
  chatId: string
  kind: IdleRecoveryChatKind
  agent: string
  cwd: string
  title: string
  workspace: string
  worktreeId: string | null
  role: IdleRecoveryRole
  requestSource: IdleRecoveryRequestSource
  /** The prompt of the turn that ended, as the agent row shows it. */
  lastPrompt: string
  /** Epoch ms the chat went idle. */
  idleSince: number
  backgroundPending: boolean
  scheduledWake: boolean
  /** A coordinator with open dispatches or live children. */
  coordinatorBusy: boolean
}

/** The end of a candidate's conversation, as the classifier is shown it. */
export type IdleRecoveryEnding = {
  lastUserRequest: string
  lastAssistantMessage: string
}

export type IdleRecoverySweepResult = {
  /** True when the inbox differs from before this sweep. */
  changed: boolean
  /** Chats that started waiting on the user in this sweep, for notifications. */
  newlyWaiting: ForkIdleRecoveryInboxItem[]
}
