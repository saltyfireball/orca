// Keeps every bot's Needs you count published (FORK.md "Needs you list", BAD-795), so its sidebar
// row says the number its panel lists whether or not the bot is the one on screen. Behind one line
// in `ForkRootHosts`; the reads are the panel's own, shared per bot and re-read on its changes only.
import React, { useMemo } from 'react'
import { useBotHostOffline } from '@/lib/bot-host-views'
import { botRefKey } from '@/lib/bot-hosts'
import { useBots } from '@/lib/bot-catalog'
import { useBotNeedsYouCount, useBotNow } from '@/components/bots/use-bot-now'
import type { Bot } from '../../../../shared/bot-types'

function ForkBotNeedsYouPublisher({ bot }: { bot: Bot }): null {
  useBotNeedsYouCount(bot, useBotNow(bot))
  return null
}

/** An away server's bots are not read; their rows count what they hold, as before. */
function ForkBotNeedsYouReader({ bot }: { bot: Bot }): React.JSX.Element | null {
  return useBotHostOffline(bot.hostId) ? null : <ForkBotNeedsYouPublisher bot={bot} />
}

export function ForkBotNeedsYouHost(): React.JSX.Element {
  const bots = useBots()
  const awake = useMemo(() => bots.filter((bot) => !bot.paused), [bots])
  return (
    <>
      {awake.map((bot) => (
        <ForkBotNeedsYouReader key={botRefKey(bot)} bot={bot} />
      ))}
    </>
  )
}
