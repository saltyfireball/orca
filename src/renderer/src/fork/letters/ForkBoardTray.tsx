// The board (FORK.md "Letters and the board", SLRM-2389): a compact tray above a chat's message
// box with the asks that chat filed for the user. It starts closed: one line with the count and
// the first ask. Open, it lists every ask as a collapsed row, in a capped scroll area so the
// conversation keeps its room. Escape closes it. Renders nothing while the board is off or the
// chat has no open ask, and switching chats closes it.
import React, { useRef, useState } from 'react'
import { ChevronDown, ChevronUp, ClipboardList } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { useForkBoard, useForkBoardEnabled } from './board-store'
import { ForkBoardAskRow, forkBoardTypeLabel } from './ForkBoardAskRow'

function Tray({ sessionId }: { sessionId: string }): React.JSX.Element | null {
  const t = useTranslate()
  const { view } = useForkBoard(true)
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const asks = (view?.asks ?? []).filter((ask) => ask.from.chatId === sessionId)
  if (!view || asks.length === 0) {
    return null
  }
  // The host's clock at the last read; the board is read again every 30 s.
  const now = view.now
  const first = asks[0]
  const label = t('fork.board.trayLabel', '{{count}} asks for you from this chat', {
    count: asks.length
  })
  return (
    <div
      className="mx-3 mb-1 rounded-md border border-border/60 bg-card/50 text-xs"
      data-fork-board-tray=""
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation()
          setOpen(false)
          trigger.current?.focus()
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="flex w-full items-center gap-2 px-2 py-1 text-left text-muted-foreground hover:text-foreground"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((value) => !value)}
      >
        <ClipboardList className="size-3 shrink-0" aria-hidden />
        <span className="min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 font-semibold text-primary-foreground tabular-nums">
          {asks.length}
        </span>
        <span className="shrink-0 uppercase">{forkBoardTypeLabel(first.type, t)}</span>
        <span className="min-w-0 flex-1 truncate text-foreground">{first.title}</span>
        {open ? (
          <ChevronDown className="size-3 shrink-0" aria-hidden />
        ) : (
          <ChevronUp className="size-3 shrink-0" aria-hidden />
        )}
      </button>
      {open ? (
        <ul className="scrollbar-sleek max-h-60 overflow-y-auto border-t border-border/60 px-2">
          {asks.map((ask) => (
            <ForkBoardAskRow
              key={`${ask.source?.environmentId ?? ''}:${ask.id}`}
              ask={ask}
              now={now}
            />
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export function ForkBoardTray({
  sessionId
}: {
  sessionId: string | undefined
}): React.JSX.Element | null {
  const enabled = useForkBoardEnabled()
  // The board is read only inside `Tray`, so nothing is read while it is off.
  // Keyed by chat, so switching chats starts the tray closed.
  return enabled && sessionId ? <Tray key={sessionId} sessionId={sessionId} /> : null
}
