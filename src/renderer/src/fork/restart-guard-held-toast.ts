import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { isForkRestartHeld } from '../../../shared/fork/restart-guard-held'

/** True when the restart guard held this restart; it then shows a neutral toast instead of an error. */
export function handleForkRestartHeld(result: unknown): boolean {
  if (!isForkRestartHeld(result)) {
    return false
  }
  if (result.forkRestartHeld === 'waiting') {
    toast.info(
      translate('fork.restartGuard.heldWaitingToast', 'Restart will run once your chats are idle.')
    )
  }
  return true
}
