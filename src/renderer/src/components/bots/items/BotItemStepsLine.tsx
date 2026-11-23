// Fork BAD-762: the slim "Steps 1 of 3" line pinned at the top of an item whose steps sit in its ask's
// card: a tap scrolls to the first step not done. The list itself shows once, in the card.
import { ListChecks } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import {
  botItemCurrentStepIndex,
  type BotItemStepsView
} from '../../../../../shared/bots/bot-item-steps'

export function BotItemStepsLine({
  view,
  onShow
}: {
  view: BotItemStepsView
  onShow: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const total = view.steps.length
  const at = Math.min(botItemCurrentStepIndex(view) + 1, total)
  return (
    <button
      type="button"
      data-bot-item-steps-line
      className="flex min-w-0 items-center gap-1.5 self-start rounded text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onShow}
    >
      <ListChecks className="size-3 shrink-0" />
      {t('bots.items.steps.line', 'Steps {{at}} of {{total}}', { at, total })}
    </button>
  )
}
