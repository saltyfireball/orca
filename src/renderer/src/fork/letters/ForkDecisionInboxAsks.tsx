// The board in the Decision inbox (FORK.md "Letters and the board", SLRM-2389): every open ask,
// from this host and its paired servers, oldest first, each with Go to chat, Done and Throw back.
// Also the link to the letters history. Both render nothing while their feature is off.
import React from 'react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import type { ForkBoardViewAsk } from '../../../../shared/fork/letters-wire'
import { openForkLetters, useForkLettersEnabled } from './board-store'
import { ForkBoardAskRow } from './ForkBoardAskRow'

export function ForkDecisionInboxAsks({
  asks,
  now
}: {
  asks: readonly ForkBoardViewAsk[]
  /** The host's clock at the board's last read. */
  now: number
}): React.JSX.Element | null {
  const t = useTranslate()
  if (asks.length === 0) {
    return null
  }
  const title = t('fork.board.inboxTitle', 'Asks for you')
  return (
    <section aria-label={title}>
      <h3 className="text-xs font-medium text-muted-foreground">
        {title} ({asks.length})
      </h3>
      <ul>
        {asks.map((ask) => (
          <ForkBoardAskRow
            key={`${ask.source?.environmentId ?? ''}:${ask.id}`}
            ask={ask}
            now={now}
            showJump
          />
        ))}
      </ul>
    </section>
  )
}

export function ForkDecisionInboxLettersLink(): React.JSX.Element | null {
  const t = useTranslate()
  const enabled = useForkLettersEnabled()
  if (!enabled) {
    return null
  }
  return (
    <div className="flex justify-end">
      <Button size="sm" variant="ghost" onClick={() => openForkLetters(null)}>
        {t('fork.board.letters', 'Letters between chats')}
      </Button>
    </div>
  )
}
