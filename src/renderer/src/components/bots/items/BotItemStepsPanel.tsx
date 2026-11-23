// Fork BAD-747: an item's steps in its panel: marks go to the host (the owner's panel only), a refusal
// shows as a toast, and Open in terminal comes from the bot's workspace and the computers Orca knows.
import { toast } from 'sonner'
import type { Bot } from '../../../../../shared/bot-types'
import type { BotItem } from '../../../../../shared/bots/bot-items'
import { useBotStepTerminal } from '../../../fork/bot-owner-steps/use-bot-step-terminal'
import { botErrorMessage } from '../bot-presentation'
import { BotItemSteps } from './BotItemSteps'
import { markBotItemStep } from './bot-item-steps-actions'

export function BotItemStepsPanel({
  bot,
  item
}: {
  bot: Bot
  item: BotItem
}): React.JSX.Element | null {
  const terminalFor = useBotStepTerminal(bot)
  if (!item.steps) {
    return null
  }
  return (
    <BotItemSteps
      view={item.steps}
      terminalFor={terminalFor}
      onMark={(step, state, error) =>
        markBotItemStep(bot, item, step, state, error).then(
          () => true,
          (reason: unknown) => {
            toast.error(botErrorMessage(reason))
            return false
          }
        )
      }
    />
  )
}
