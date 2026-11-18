// The board (FORK.md "Letters and the board", SLRM-2389): what an ask row can do. Done and Throw
// back go to the main process, which closes the ask on the host that holds it (this one or a
// paired server); Go to chat is the Decision inbox's jump.
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type { ForkBoardViewAsk } from '../../../../shared/fork/letters-wire'
import { jumpToDecisionInboxChat } from '../decision-inbox/decision-inbox-actions'
import { forkLettersBridge, refreshForkBoard } from './board-store'

/** Resolves true when the ask was closed. */
export async function closeForkBoardAsk(
  ask: ForkBoardViewAsk,
  action: 'done' | 'back',
  note?: string
): Promise<boolean> {
  const bridge = forkLettersBridge()
  if (!bridge) {
    return false
  }
  try {
    const result = await bridge.closeAsk({
      id: ask.id,
      environmentId: ask.source?.environmentId ?? null,
      action,
      ...(note ? { note } : {})
    })
    if (!result.ok) {
      toast.error(translate('fork.board.toast.closeFailed', 'Could not close the ask.'), {
        description: result.error
      })
      return false
    }
    if (action === 'back') {
      toast.success(
        translate('fork.board.toast.thrown', 'Thrown back. The chat gets your note after its turn.')
      )
    }
    return true
  } catch (failure) {
    toast.error(translate('fork.board.toast.closeFailed', 'Could not close the ask.'), {
      description: failure instanceof Error ? failure.message : String(failure)
    })
    return false
  } finally {
    void refreshForkBoard()
  }
}

/** True when the asking chat has a tab here; the inbox's jump toasts when it has none. */
export function jumpToForkBoardAsk(ask: ForkBoardViewAsk): boolean {
  if (ask.from.kind === 'shell') {
    return false
  }
  return jumpToDecisionInboxChat({
    kind: ask.from.kind === 'terminal' ? 'terminal' : 'chat',
    chatId: ask.from.chatId,
    worktreeId: ask.from.worktreeId
  })
}
