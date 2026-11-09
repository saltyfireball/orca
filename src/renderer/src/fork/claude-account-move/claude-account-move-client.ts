// SLRM-1503: move a native Claude chat, or a worktree's Claude chats, to another account of the
// host that runs them, through that host's fork.claudeAccount.* RPC. A busy chat's move waits for
// its turn; the toast offers to stop the turn now or drop the move.
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import type {
  ForkClaudeCantMoveReason,
  ForkClaudeMoveResponse,
  ForkClaudeMoveResult,
  ForkClaudeWhichResponse
} from '../../../../shared/fork/claude-account-move'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'

export type ForkClaudeMoveScope = { sessionId: string } | { worktreeId: string }

export type ForkClaudeAccountMovedListener = (
  target: RuntimeClientTarget,
  results: readonly ForkClaudeMoveResult[]
) => void

const movedListeners = new Set<ForkClaudeAccountMovedListener>()

/**
 * Told after every move, queued, stopped or cancelled, with the sessions it touched. The account
 * chip's cache (claude-chip-host-cache.ts) subscribes here and reads those chats again.
 */
export function onForkClaudeAccountMoved(listener: ForkClaudeAccountMovedListener): () => void {
  movedListeners.add(listener)
  return () => {
    movedListeners.delete(listener)
  }
}

function notifyMoved(target: RuntimeClientTarget, results: readonly ForkClaudeMoveResult[]) {
  for (const listener of movedListeners) {
    listener(target, results)
  }
}

function scopeParams(scope: ForkClaudeMoveScope) {
  return 'sessionId' in scope ? { sessionId: scope.sessionId } : { worktree: scope.worktreeId }
}

export function readClaudeChatAccounts(
  target: RuntimeClientTarget,
  scope?: ForkClaudeMoveScope
): Promise<ForkClaudeWhichResponse> {
  return callRuntimeRpc<ForkClaudeWhichResponse>(
    target,
    'fork.claudeAccount.which',
    scope ? scopeParams(scope) : {}
  )
}

export function cantMoveText(reason: ForkClaudeCantMoveReason | undefined): string {
  switch (reason) {
    case 'not-found':
      return translate('fork.accountMove.reason.notFound', 'the chat is gone from its host')
    case 'not-claude':
      return translate('fork.accountMove.reason.notClaude', 'it is not a Claude chat')
    case 'wsl-chat':
      return translate(
        'fork.accountMove.reason.wsl',
        'it runs in WSL, which follows its own account selection'
      )
    case 'unknown-account':
      return translate('fork.accountMove.reason.unknownAccount', 'that account is not on its host')
    case 'history-not-shared':
      return translate(
        'fork.accountMove.reason.history',
        'that account does not share conversation history, so it could not resume'
      )
    case 'account-setup-failed':
      return translate('fork.accountMove.reason.setup', 'that account could not be prepared')
    case 'stop-failed':
      return translate('fork.accountMove.reason.stop', 'its turn could not be stopped')
    case undefined:
      return translate('fork.accountMove.reason.refused', 'its host refused')
  }
}

function summarize(response: ForkClaudeMoveResponse, accountLabel: string): void {
  const moved = response.results.filter(
    (result) => result.status === 'moved' || result.status === 'unchanged'
  )
  const queued = response.results.filter((result) => result.status === 'queued')
  const refused = response.results.filter((result) => result.status === 'cant-move')
  for (const result of refused) {
    toast.error(
      translate('fork.accountMove.cantMove', "Can't move {{name}}: {{reason}}.", {
        name: result.name,
        reason: cantMoveText(result.reason)
      })
    )
  }
  if (queued.length > 0) {
    return
  }
  if (moved.length > 0) {
    toast.success(
      moved.length === 1
        ? translate(
            'fork.accountMove.movedOne',
            '{{name}} moved to {{account}}. It resumes there at its next message.',
            { name: moved[0].name, account: accountLabel }
          )
        : translate(
            'fork.accountMove.movedMany',
            '{{count}} chats moved to {{account}}. Each resumes there at its next message.',
            { count: moved.length, account: accountLabel }
          )
    )
  } else if (refused.length === 0) {
    toast.info(translate('fork.accountMove.none', 'No Claude chats to move here.'))
  }
}

function queuedToast(
  target: RuntimeClientTarget,
  queued: readonly ForkClaudeMoveResult[],
  accountId: string | null,
  accountLabel: string
): void {
  const sessionIds = queued.map((result) => result.sessionId)
  toast.info(
    queued.length === 1
      ? translate(
          'fork.accountMove.queuedOne',
          '{{name}} is mid-turn. It moves to {{account}} when the turn ends.',
          { name: queued[0].name, account: accountLabel }
        )
      : translate(
          'fork.accountMove.queuedMany',
          '{{count}} chats are mid-turn. They move to {{account}} when their turns end.',
          { count: queued.length, account: accountLabel }
        ),
    {
      duration: 20_000,
      action: {
        label: translate('fork.accountMove.moveNow', 'Move now'),
        onClick: () => {
          void moveQueuedNow(target, sessionIds, accountId, accountLabel)
        }
      },
      cancel: {
        label: translate('fork.accountMove.cancel', 'Cancel'),
        onClick: () => {
          void cancelQueued(target, sessionIds)
        }
      }
    }
  )
}

async function moveQueuedNow(
  target: RuntimeClientTarget,
  sessionIds: readonly string[],
  accountId: string | null,
  accountLabel: string
): Promise<void> {
  for (const sessionId of sessionIds) {
    await moveClaudeChatsToAccount(target, { sessionId }, accountId, { accountLabel, now: true })
  }
}

async function cancelQueued(target: RuntimeClientTarget, sessionIds: readonly string[]) {
  const cancelled: ForkClaudeMoveResult[] = []
  for (const sessionId of sessionIds) {
    try {
      const reply = await callRuntimeRpc<{ cancelled: boolean }>(
        target,
        'fork.claudeAccount.cancel',
        { sessionId }
      )
      if (reply.cancelled) {
        cancelled.push({ sessionId, name: sessionId, status: 'unchanged' })
      }
    } catch {
      // The turn may already have ended and the move run; nothing left to cancel.
    }
  }
  notifyMoved(target, cancelled)
  toast.info(
    cancelled.length > 0
      ? translate('fork.accountMove.cancelled', 'Move cancelled.')
      : translate('fork.accountMove.cancelTooLate', 'Too late to cancel: the move already ran.')
  )
}

/** Move the chats in scope; reports through toasts and returns the host's per-chat results. */
export async function moveClaudeChatsToAccount(
  target: RuntimeClientTarget,
  scope: ForkClaudeMoveScope,
  accountId: string | null,
  options: { accountLabel: string; now?: boolean }
): Promise<ForkClaudeMoveResponse | null> {
  let response: ForkClaudeMoveResponse
  try {
    response = await callRuntimeRpc<ForkClaudeMoveResponse>(target, 'fork.claudeAccount.move', {
      accountId,
      ...scopeParams(scope),
      ...(options.now ? { now: true } : {})
    })
  } catch (error) {
    toast.error(
      translate('fork.accountMove.failed', 'Could not move: {{message}}', {
        message: error instanceof Error ? error.message : String(error)
      })
    )
    return null
  }
  notifyMoved(target, response.results)
  summarize(response, options.accountLabel)
  const queued = response.results.filter((result) => result.status === 'queued')
  if (queued.length > 0) {
    queuedToast(target, queued, accountId, options.accountLabel)
  }
  return response
}
