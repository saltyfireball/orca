// The board (FORK.md "Letters and the board", SLRM-2389): one ask, as a collapsed details row
// whose summary fits one line. Opened, it shows the agent's text (its own words, shown as plain
// text, never run), Done, and Throw back with a note. The tray above the composer and the
// Decision inbox both render it; the inbox adds Go to chat.
import React, { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { FORK_BOARD_NOTE_MAX_CHARS, type ForkBoardAskType } from '../../../../shared/fork/letters'
import type { ForkBoardViewAsk } from '../../../../shared/fork/letters-wire'
import { sleeperAge } from '../sleepers/ForkSleepersRow'
import { closeForkBoardAsk, jumpToForkBoardAsk } from './board-actions'

export function forkBoardTypeLabel(type: ForkBoardAskType, t: Translate): string {
  if (type === 'REVIEW') {
    return t('fork.board.type.review', 'Review')
  }
  return type === 'DECIDE' ? t('fork.board.type.decide', 'Decide') : t('fork.board.type.do', 'Do')
}

export function forkBoardAskFrom(ask: ForkBoardViewAsk, t: Translate): string {
  const who =
    ask.from.kind === 'shell'
      ? t('fork.board.fromShell', 'a command outside any agent')
      : ask.from.title || ask.from.chatId.slice(0, 12)
  return ask.source ? `${who} @ ${ask.source.name}` : who
}

export function ForkBoardAskRow({
  ask,
  now,
  showJump
}: {
  ask: ForkBoardViewAsk
  now: number
  showJump?: boolean
}): React.JSX.Element {
  const t = useTranslate()
  const bodyId = useId()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const close = (action: 'done' | 'back'): void => {
    if (busy || (action === 'back' && !note.trim())) {
      return
    }
    setBusy(true)
    void closeForkBoardAsk(ask, action, action === 'back' ? note.trim() : undefined)
      .then((closed) => {
        if (closed) {
          setNote('')
        }
      })
      .finally(() => setBusy(false))
  }
  const typeLabel = forkBoardTypeLabel(ask.type, t)
  return (
    <li className="border-b border-border/50 text-sm last:border-b-0" data-fork-board-ask={ask.id}>
      <details className="group">
        <summary className="flex cursor-pointer items-center gap-2 py-1.5 select-none">
          <span className="shrink-0 rounded-full border border-border px-1.5 text-[10px] leading-4 text-muted-foreground uppercase">
            {typeLabel}
          </span>
          <span className="min-w-0 flex-1 truncate">{ask.title}</span>
          <span className="max-w-40 shrink-0 truncate text-xs text-muted-foreground">
            {forkBoardAskFrom(ask, t)}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {sleeperAge(now - ask.at, t)}
          </span>
        </summary>
        <div className="flex flex-col gap-2 pb-3">
          {ask.body ? (
            <p
              id={bodyId}
              className="scrollbar-sleek max-h-40 overflow-y-auto break-words whitespace-pre-wrap text-foreground select-text"
            >
              {ask.body}
            </p>
          ) : null}
          <Textarea
            className="min-h-12"
            rows={2}
            aria-label={t('fork.board.noteLabel', 'Note to throw {{title}} back', {
              title: ask.title
            })}
            aria-describedby={ask.body ? bodyId : undefined}
            placeholder={t(
              'fork.board.notePlaceholder',
              'To throw it back, say what is missing. The chat gets this after its turn.'
            )}
            maxLength={FORK_BOARD_NOTE_MAX_CHARS}
            disabled={busy}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="flex flex-wrap justify-end gap-1">
            {showJump && ask.from.kind !== 'shell' ? (
              <Button size="sm" variant="ghost" onClick={() => jumpToForkBoardAsk(ask)}>
                {t('fork.board.jump', 'Go to chat')}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || !note.trim()}
              onClick={() => close('back')}
            >
              {t('fork.board.back', 'Throw back')}
            </Button>
            <Button size="sm" disabled={busy} onClick={() => close('done')}>
              {t('fork.board.done', 'Done')}
            </Button>
          </div>
        </div>
      </details>
    </li>
  )
}
