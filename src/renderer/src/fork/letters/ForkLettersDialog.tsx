// Letters (FORK.md "Letters and the board", SLRM-2389): the history view. Every letter of one
// chat (or of every chat), newest first, from this host and each paired server, with who wrote
// to whom, its state and its text as plain text. A name filters the view to that chat. It reads
// `window.api.forkLetters` only while open.
import React, { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import type { ForkLetterParty, ForkLetterState } from '../../../../shared/fork/letters'
import type {
  ForkLettersHistoryView,
  ForkLettersViewLetter
} from '../../../../shared/fork/letters-wire'
import { sleeperAge } from '../sleepers/ForkSleepersRow'
import { closeForkLetters, forkLettersBridge, useForkLettersOpen } from './board-store'

type Filter = { chatId: string | null; title: string }

function partyName(party: ForkLetterParty, t: Translate): string {
  const name =
    party.kind === 'shell'
      ? party.chatId === 'board'
        ? t('fork.letters.board', 'the board')
        : t('fork.letters.shell', 'a command outside any agent')
      : party.title || party.chatId.slice(0, 12)
  return party.host ? `${name} @ ${party.host.name}` : name
}

function stateLabel(state: ForkLetterState, t: Translate): string {
  switch (state) {
    case 'queued':
      return t('fork.letters.state.queued', 'waiting for the turn to end')
    case 'delivered':
      return t('fork.letters.state.delivered', 'delivered')
    case 'forwarded':
      return t('fork.letters.state.forwarded', 'handed to the other host')
    case 'pickup':
      return t('fork.letters.state.pickup', 'waiting for the other host')
    case 'expired':
      return t('fork.letters.state.expired', 'expired')
    default:
      return t('fork.letters.state.failed', 'not sent')
  }
}

function Party({
  party,
  t,
  onPick
}: {
  party: ForkLetterParty
  t: Translate
  onPick: (filter: Filter) => void
}): React.JSX.Element {
  const name = partyName(party, t)
  if (party.kind === 'shell') {
    return <span>{name}</span>
  }
  return (
    <button
      type="button"
      className="truncate underline-offset-2 hover:text-foreground hover:underline"
      title={t('fork.letters.filterTo', 'Show only the letters of {{name}}', { name })}
      onClick={() => onPick({ chatId: party.chatId, title: name })}
    >
      {name}
    </button>
  )
}

function Row({
  letter,
  now,
  onPick
}: {
  letter: ForkLettersViewLetter
  now: number
  onPick: (filter: Filter) => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <li className="flex flex-col gap-1 border-b border-border/50 py-2 text-sm last:border-b-0">
      <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
        <Party party={letter.from} t={t} onPick={onPick} />
        <span aria-hidden>-&gt;</span>
        <Party party={letter.to} t={t} onPick={onPick} />
        <span className="ml-auto shrink-0">
          {stateLabel(letter.state, t)} - {sleeperAge(now - letter.at, t)}
        </span>
      </div>
      <p className="scrollbar-sleek max-h-32 overflow-y-auto break-words whitespace-pre-wrap text-foreground select-text">
        {letter.text}
      </p>
      {letter.note && letter.state !== 'delivered' ? (
        <p className="text-xs text-muted-foreground">{letter.note}</p>
      ) : null}
      <p className="text-[10px] text-muted-foreground tabular-nums">
        {letter.id}
        {letter.cite ? ` - ${t('fork.letters.cites', 'answers {{id}}', { id: letter.cite })}` : ''}
      </p>
    </li>
  )
}

function Body({
  filter,
  onPick
}: {
  filter: Filter
  onPick: (f: Filter) => void
}): React.JSX.Element {
  const t = useTranslate()
  const [view, setView] = useState<ForkLettersHistoryView | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const bridge = forkLettersBridge()
    if (!bridge) {
      return
    }
    let live = true
    const read = (): void => {
      bridge.history(filter.chatId).then(
        (next) => {
          if (live) {
            setView(next)
            setError(null)
          }
        },
        (failure: unknown) => {
          if (live) {
            setError(failure instanceof Error ? failure.message : String(failure))
          }
        }
      )
    }
    read()
    const off = bridge.onChanged(read)
    return () => {
      live = false
      off()
    }
  }, [filter.chatId])
  if (!view) {
    return error ? (
      <p className="text-sm text-destructive">{error}</p>
    ) : (
      <p className="text-sm text-muted-foreground">{t('fork.letters.loading', 'Loading...')}</p>
    )
  }
  return (
    <div className="scrollbar-sleek flex min-h-0 flex-1 flex-col overflow-y-auto">
      {view.unreachable.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('fork.letters.unreachable', 'Not answering: {{names}}', {
            names: view.unreachable.join(', ')
          })}
        </p>
      ) : null}
      {view.letters.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t('fork.letters.empty', 'No letters yet.')}
        </p>
      ) : (
        <ul>
          {view.letters.map((letter) => (
            <Row
              key={`${letter.source?.environmentId ?? ''}:${letter.id}`}
              letter={letter}
              now={view.now}
              onPick={onPick}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function Open({ initial }: { initial: Filter }): React.JSX.Element {
  const t = useTranslate()
  const [filter, setFilter] = useState<Filter>(initial)
  return (
    <Dialog open onOpenChange={(next) => !next && closeForkLetters()}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('fork.letters.title', 'Letters')}</DialogTitle>
          <DialogDescription>
            {filter.chatId
              ? t('fork.letters.descriptionChat', 'Letters to and from {{name}}.', {
                  name: filter.title || filter.chatId.slice(0, 12)
                })
              : t(
                  'fork.letters.descriptionAll',
                  'Messages chats sent each other with orca letter send, newest first. Pick a name to see one chat.'
                )}
          </DialogDescription>
        </DialogHeader>
        {filter.chatId ? (
          <div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setFilter({ chatId: null, title: '' })}
            >
              {t('fork.letters.showAll', 'Show every chat')}
            </Button>
          </div>
        ) : null}
        <Body filter={filter} onPick={setFilter} />
      </DialogContent>
    </Dialog>
  )
}

export function ForkLettersDialogHost(): React.JSX.Element | null {
  const target = useForkLettersOpen()
  if (!target) {
    return null
  }
  return <Open key={`${target.chatId ?? ''}`} initial={target} />
}
