// Fork BAD-762: where an item's open owner steps are drawn on the phone. With a loaded ask they sit in
// its card (the page shows a slim steps line at its top), otherwise above the Activity. Kept out of
// MobileBotItemPage so that file stays under its line limit.
import type { ReactNode } from 'react'
import { botItemStepsPlace } from '../../../../src/shared/bots/bot-item-steps'
import type { BotItem, BotItemEvent } from '../../../../src/shared/bots/bot-items'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { MobileBotItemStepsPanel } from './MobileBotItemSteps'
import { MobileBotItemStepsLine } from './MobileBotItemStepsLine'
import { useMobileBotItemStepsScroll } from './use-mobile-bot-item-steps-scroll'

export function useMobileBotItemOwnerSteps({
  client,
  item,
  events,
  online,
  hostName,
  showToast,
  center
}: {
  client: RpcClient | null
  item: BotItem | null
  events: readonly BotItemEvent[]
  /** Whether the host answers: the steps can be ticked only then. */
  online: boolean
  hostName: string
  showToast: (message: string) => void
  /** The page's scroll to a span measured in the window (the item follow's `center`). */
  center: (y: number, height: number, animated: boolean) => void
}): { line: ReactNode; above: ReactNode; inAsk: ReactNode } {
  const place =
    item && item.status !== 'done' && item.status !== 'canceled'
      ? botItemStepsPlace(item, events)
      : 'none'
  const scroll = useMobileBotItemStepsScroll({
    center,
    inAskSet: place === 'ask' ? (item?.steps?.eventId ?? null) : null,
    ready: events.length > 0
  })
  const panel = item ? (
    <MobileBotItemStepsPanel
      client={client}
      item={item}
      online={online}
      hostName={hostName}
      showToast={showToast}
      currentRef={scroll.currentStep}
    />
  ) : null
  return {
    line:
      place === 'ask' && item?.steps ? (
        <MobileBotItemStepsLine view={item.steps} onPress={() => scroll.reveal(true)} />
      ) : null,
    above: place === 'above' ? panel : null,
    inAsk: place === 'ask' ? panel : null
  }
}
