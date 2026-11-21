// Bot asks in the Decision inbox (FORK.md "Idle recovery", SLRM-2453): every item a bot set to
// Needs you, on this computer and its paired servers, oldest first. Each ask has Open, which shows
// the item on its bot's Home tab, where upstream's quick replies and comment box answer it. Also
// the always-mounted watcher that keeps the asks read while the feature is on, so new ones are told.
import React from 'react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { useBots, openBotHomeTab } from '@/lib/bot-catalog'
import { openBotItem } from '@/components/bots/items/bot-item-open'
import { useBotHostLabel } from '@/components/bots/use-bot-host-label'
import { formatBotItemNumber } from '../../../../shared/bots/bot-items'
import { sleeperAge } from '../sleepers/ForkSleepersRow'
import { closeForkDecisionInbox } from '../decision-inbox/decision-inbox-store'
import { useForkBotAsks, useForkBotAsksEnabled } from './bot-asks-store'
import { forkBotAskLine, type ForkBotAsk } from './bot-asks-view'

/** Keeps the bots and their asks read while bot asks are on; renders nothing. */
export function ForkBotAsksWatcher(): null {
  const enabled = useForkBotAsksEnabled()
  // The catalog loads once something reads it; the sidebar usually has already.
  useBots(enabled)
  useForkBotAsks(enabled)
  return null
}

async function openAsk(ask: ForkBotAsk): Promise<void> {
  closeForkDecisionInbox()
  await openBotHomeTab(ask.bot)
  openBotItem(ask.bot, ask.item.uid)
}

function BotAskRow({ ask, now }: { ask: ForkBotAsk; now: number }): React.JSX.Element {
  const t = useTranslate()
  const host = useBotHostLabel(ask.bot.hostId)
  const name = ask.item.owner.name ?? ask.bot.name
  return (
    <li
      className="flex flex-col gap-1 border-b border-border/50 py-1.5 text-sm last:border-b-0"
      data-fork-bot-ask={ask.key}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate" title={ask.item.title}>
          {forkBotAskLine(ask)}
        </span>
        <span className="max-w-48 shrink-0 truncate text-xs text-muted-foreground">
          {host ? `${name} @ ${host}` : name}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {sleeperAge(Math.max(0, now - ask.since), t)}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {formatBotItemNumber(ask.item.number)} {ask.item.title}
        </span>
        <Button size="sm" variant="ghost" onClick={() => void openAsk(ask)}>
          {t('fork.botAsks.open', 'Open')}
        </Button>
      </div>
    </li>
  )
}

export function ForkDecisionInboxBotAsks({
  asks,
  now
}: {
  asks: readonly ForkBotAsk[]
  /** This window's clock. */
  now: number
}): React.JSX.Element | null {
  const t = useTranslate()
  if (asks.length === 0) {
    return null
  }
  const title = t('fork.botAsks.inboxTitle', 'Bot asks')
  return (
    <section aria-label={title}>
      <h3 className="text-xs font-medium text-muted-foreground">
        {title} ({asks.length})
      </h3>
      <ul>
        {asks.map((ask) => (
          <BotAskRow key={ask.key} ask={ask} now={now} />
        ))}
      </ul>
    </section>
  )
}
