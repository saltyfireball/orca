// Fork BAD-762: where an item's open steps are drawn. With a loaded ask they sit in its card (the pane
// then shows a slim "Steps 1 of 3" line at its top), otherwise above the Activity. On open at an ask, a
// card taller than the pane starts at its first step to do, not at its end.
import { useEffect } from 'react'
import type { BotItem } from '../../../../../shared/bots/bot-items'
import { botItemStepsPlace } from '../../../../../shared/bots/bot-item-steps'
import type { Bot } from '../../../../../shared/bot-types'
import { BotItemStepsPanel } from './BotItemStepsPanel'
import { BotItemStepsLine } from './BotItemStepsLine'
import { revealCurrentBotItemStep } from './bot-item-steps-reveal'
import type { BotItemViewRead } from './use-bot-item-view'

export function useBotItemStepsPlace(
  bot: Bot,
  item: BotItem,
  view: Pick<BotItemViewRead, 'events' | 'eventsRead'>,
  deleted: boolean,
  activityMounted: boolean,
  scrollRef: React.RefObject<HTMLDivElement | null>
): { above: React.ReactNode; inAsk: React.ReactNode; line: React.ReactNode } {
  const stepsPlace = deleted ? 'none' : botItemStepsPlace(item, view.events)
  const stepsSetId = item.steps?.eventId
  const ready = view.eventsRead && activityMounted
  useEffect(() => {
    if (stepsPlace !== 'ask' || !ready) {
      return
    }
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => revealCurrentBotItemStep(scrollRef.current, 'on-open'))
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [stepsPlace, ready, stepsSetId, scrollRef])
  const stepsLine =
    stepsPlace === 'ask' && item.steps ? (
      <BotItemStepsLine
        view={item.steps}
        onShow={() => revealCurrentBotItemStep(scrollRef.current, 'on-click')}
      />
    ) : null
  const panel = <BotItemStepsPanel bot={bot} item={item} />
  return {
    above: stepsPlace === 'above' ? panel : null,
    inAsk: stepsPlace === 'ask' ? panel : null,
    line: stepsLine
  }
}
