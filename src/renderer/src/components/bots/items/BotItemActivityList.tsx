// An item's Activity on a rail: comments on one quiet surface, and between them one muted line per event
// (worker started and finished from the worker's record, edits, links and status changes).
import { Fragment, useCallback, useRef } from 'react'
import {
  AlarmClock,
  AlarmClockOff,
  CircleCheck,
  CircleX,
  Link,
  ListChecks,
  Pencil,
  Play,
  Plus
} from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import type { Bot } from '../../../../../shared/bot-types'
import {
  BOT_ITEM_STATUSES,
  type BotItem,
  type BotItemEvent
} from '../../../../../shared/bots/bot-items'
import {
  botItemActivity,
  botItemLiveAskKey,
  botItemNeedsYouEntryKey,
  botItemWaitEntryKey,
  botItemWorkerStopReason,
  type BotItemActivityEntry
} from '../../../../../shared/bots/bot-item-activity'
import { botItemActorName } from '../../../../../shared/bots/bot-item-actor-name'
import { BotItemCommentCard } from './BotItemCommentCard'
import {
  BotItemNeedsYouMarkBox,
  botItemMadeAt,
  type BotItemNeedsYouMark
} from './BotItemNeedsYouMark'
import { BotItemWaitCard } from './BotItemWaitCard'
import { revealBotItemComment } from './bot-item-comment-reveal'
import type { BotItemQuickReplyActions } from './use-bot-item-question-steps'
import { NativeChatMessageTimestamp } from '../../native-chat/messages/rows/NativeChatMessageTimestamp'
import { BotItemStatusIcon } from './BotItemStatusIcon'
import { BotItemLinkedRefs } from './BotItemLinkedRefs'
import { FieldChange, statusWord, str } from './BotItemFieldChange'
import { formatBotItemSnoozeTime } from './bot-item-snooze-time'
import type { BotItemPendingComments } from '../../../../../shared/bots/bot-item-pending-comments'
import { botItemPendingAnswersOnly } from '../../../../../shared/bots/bot-item-sent-answers'
import { NATIVE_CHAT_QUOTE_SOURCE_PROPS } from '../../../../../shared/native-chat/input/quotes/native-chat-quote-selection'

const ACTOR = 'font-medium text-foreground/80'
// Where a linked event's refs go in its translated sentence.
const LINKS_SLOT = '\u0000'

function EventBody({ event, item }: { event: BotItemEvent; item: BotItem }): React.JSX.Element {
  const t = useTranslate()
  const by = <b className={ACTOR}>{botItemActorName(event, item, t)}</b>
  const { data } = event
  switch (event.kind) {
    case 'commented':
      return <>{str(data.text)}</>
    case 'edited': {
      const fields = typeof data.fields === 'object' && data.fields !== null ? data.fields : {}
      return (
        <>
          {Object.entries(fields).map(([field, change]) => (
            <FieldChange key={field} by={by} field={field} change={change} />
          ))}
        </>
      )
    }
    case 'status': {
      const note = str(data.note)
      const closed = (value: unknown) => value === 'done' || value === 'canceled'
      const reopened = closed(data.from) && !closed(data.to)
      return (
        <>
          {by}{' '}
          {data.to === 'done'
            ? t('bots.items.activity.closed', 'marked this done')
            : data.to === 'canceled'
              ? t('bots.items.activity.canceled', 'canceled this')
              : reopened
                ? t('bots.items.activity.reopened', 'reopened this')
                : t('bots.items.activity.moved', 'moved this to')}
          {closed(data.to) || reopened ? null : (
            <>
              {' '}
              <b className={ACTOR}>{statusWord(data.to, t)}</b>
            </>
          )}
          {note ? `: ${note}` : null}
        </>
      )
    }
    case 'made':
      return (
        <>
          {by}{' '}
          {data.status === 'needs_you'
            ? t('bots.items.activity.madeNeedsYou', 'added this item as Needs you')
            : t('bots.items.activity.made', 'added this item')}
        </>
      )
    case 'linked': {
      // The sentence is translated around its refs, which render with their own break points.
      const [before = '', after = ''] = t('bots.items.activity.linked', 'linked {{links}}', {
        links: LINKS_SLOT
      }).split(LINKS_SLOT)
      return (
        <>
          {by} {before}
          <BotItemLinkedRefs links={Array.isArray(data.links) ? data.links.map(String) : []} />
          {after}
        </>
      )
    }
    case 'snoozed':
      return (
        <>
          {by}{' '}
          {typeof data.until === 'number'
            ? t('bots.items.activity.snoozed', 'snoozed this until {{when}}', {
                when: formatBotItemSnoozeTime(data.until, event.at)
              })
            : t('bots.items.activity.snoozedBare', 'snoozed this')}
        </>
      )
    case 'steps': {
      const count = Array.isArray(data.steps) ? data.steps.length : 0
      // An older set shows as replaced: its commands are no longer live, so none is shown.
      return event.id === item.steps?.eventId ? (
        <>
          {by} {t('bots.items.activity.steps', 'set {{count}} steps for you', { count })}
        </>
      ) : (
        <span className="opacity-70">
          {by}{' '}
          {t('bots.items.activity.stepsReplaced', 'set {{count}} steps for you (replaced)', {
            count
          })}
        </span>
      )
    }
    case 'step': {
      const number = typeof data.index === 'number' ? data.index + 1 : 0
      return (
        <>
          {by}{' '}
          {data.state === 'failed'
            ? t('bots.items.activity.stepFailed', 'said step {{n}} did not work', { n: number })
            : data.state === 'done'
              ? t('bots.items.activity.stepDone', 'ticked step {{n}}', { n: number })
              : t('bots.items.activity.stepUndone', 'unticked step {{n}}', { n: number })}
        </>
      )
    }
    case 'steps_done':
      return (
        <>
          {by} {t('bots.items.activity.stepsDone', 'ticked every step')}
        </>
      )
    case 'unsnoozed':
      // Ended early by a new question, a close or the owner's own move: the next line says which.
      return data.early ? (
        <>{t('bots.items.activity.snoozeEnded', 'Back from snooze early')}</>
      ) : (
        <>
          {by} {t('bots.items.activity.unsnoozed', 'unsnoozed this')}
        </>
      )
  }
}

function WorkerBody({
  entry
}: {
  entry: Extract<BotItemActivityEntry, { kind: 'worker' }>
}): React.JSX.Element {
  const t = useTranslate()
  const title = <b className={ACTOR}>{entry.link.title ?? entry.link.ref}</b>
  if (entry.phase === 'started') {
    return (
      <>
        {t('bots.items.activity.workerStarted', 'Worker started:')} {title}
      </>
    )
  }
  const failed = entry.link.state === 'failed' || entry.link.state === 'stopped'
  const reason = botItemWorkerStopReason(entry.link)
  return (
    <>
      {failed
        ? t('bots.items.activity.workerFailed', 'Worker stopped:')
        : t('bots.items.activity.workerFinished', 'Worker finished:')}{' '}
      {title}
      {reason ? ` - ${reason}` : null}
      {entry.link.report ? <span className="block">{entry.link.report.subject}</span> : null}
    </>
  )
}

function EntryIcon({
  entry
}: {
  entry: Exclude<BotItemActivityEntry, { kind: 'comment' }>
}): React.JSX.Element | null {
  if (entry.kind === 'worker') {
    if (entry.phase === 'started') {
      return <Play className="size-3" />
    }
    return entry.link.state === 'failed' || entry.link.state === 'stopped' ? (
      <CircleX className="size-3" />
    ) : (
      <CircleCheck className="size-3" />
    )
  }
  const { event } = entry
  switch (event.kind) {
    case 'made':
      return <Plus className="size-3" />
    case 'edited':
      return <Pencil className="size-3" />
    case 'linked':
      return <Link className="size-3" />
    case 'snoozed':
      return <AlarmClock className="size-3" />
    case 'unsnoozed':
      return <AlarmClockOff className="size-3" />
    case 'status': {
      const status = BOT_ITEM_STATUSES.find((entry) => entry === event.data.to)
      return status ? <BotItemStatusIcon status={status} /> : null
    }
    case 'steps':
    case 'step':
    case 'steps_done':
      return <ListChecks className="size-3" />
    case 'commented':
      return null
  }
}

export function BotItemActivityList({
  bot,
  item,
  events,
  pending,
  quickReplies,
  needsYou,
  steps
}: {
  bot: Bot
  item: BotItem
  events: readonly BotItemEvent[]
  /** Comments sent from the box the host's read doesn't show yet: last, as they were sent. */
  pending?: BotItemPendingComments
  /** What the waiting question's quick replies do; absent where the item takes no comment (deleted). */
  quickReplies?: BotItemQuickReplyActions
  needsYou?: BotItemNeedsYouMark
  /** The open owner steps, drawn inside the ask's card (the comment the item waits on). */
  steps?: React.ReactNode
}): React.JSX.Element {
  const t = useTranslate()
  const entries = botItemActivity(item, events)
  const waitKey = botItemWaitEntryKey(item, entries)
  const liveAskId = botItemLiveAskKey(entries)
  // Keep the ask mounted when its marker clears during Send.
  const needsYouKey =
    quickReplies?.steps?.askId ?? (needsYou ? botItemNeedsYouEntryKey(item, entries) : null)
  const list = useRef<HTMLDivElement | null>(null)
  // A reply's quote leads to its question, focused so Tab goes on from there.
  const jump = useCallback(
    (eventId: string) => revealBotItemComment(list.current, eventId, 'focus'),
    []
  )
  const drawEntry = (entry: BotItemActivityEntry): React.ReactNode => {
    // An answer reads on its question's lines.
    if (entry.kind === 'comment' && entry.onAsk) {
      return null
    }
    if (entry.kind === 'comment') {
      return (
        <BotItemCommentCard
          bot={bot}
          item={item}
          // A several-question card stays live until the host read confirms the send.
          entry={
            quickReplies?.sent?.has(entry.event.id) && quickReplies.steps?.askId !== entry.event.id
              ? { ...entry, waiting: false }
              : entry
          }
          onJump={jump}
          liveAskId={liveAskId}
          quickReplies={quickReplies}
          steps={entry.event.id === item.question?.eventId ? steps : undefined}
        />
      )
    }
    // Shown last, as its card, while the item waits.
    if (entry.key === waitKey) {
      return null
    }
    return (
      <div className="relative flex min-w-0 flex-wrap items-start gap-x-2 py-[3px] text-xs leading-[18px] text-muted-foreground">
        <span className="flex h-[18px] w-5 shrink-0 items-center justify-center bg-sidebar">
          <EntryIcon entry={entry} />
        </span>
        {/* Any long word (a path, a URL, a linked ref) wraps, so the page never scrolls sideways. */}
        <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          {entry.kind === 'worker' ? (
            <WorkerBody entry={entry} />
          ) : (
            <EventBody event={entry.event} item={item} />
          )}
        </div>
        {entry.kind === 'event' && entry.event.kind === 'made' ? (
          <span className="shrink-0 text-2xs text-muted-foreground @max-[340px]:basis-full @max-[340px]:pl-7">
            {botItemMadeAt(entry.at)}
          </span>
        ) : (
          <NativeChatMessageTimestamp
            timestamp={entry.at}
            // A narrow pane puts the time under the line, so dates don't squeeze it.
            className="shrink-0 text-2xs text-muted-foreground @max-[340px]:basis-full @max-[340px]:pl-7"
          />
        )}
      </div>
    )
  }
  // The rail runs through the event glyphs; each glyph and card sits on the panel fill over it.
  return (
    <>
      <div
        ref={list}
        // Comments and events quote into the item's comment box, as replies do into chat's composer.
        {...NATIVE_CHAT_QUOTE_SOURCE_PROPS}
        className="relative flex flex-col before:absolute before:inset-y-2.5 before:left-[9.5px] before:w-px before:bg-foreground/12"
      >
        {entries.map((entry) => {
          const row = drawEntry(entry)
          if (row === null) {
            return null
          }
          return entry.key === needsYouKey ? (
            <BotItemNeedsYouMarkBox key={entry.key} mark={needsYou}>
              {row}
            </BotItemNeedsYouMarkBox>
          ) : (
            <Fragment key={entry.key}>{row}</Fragment>
          )
        })}
        {item.status === 'waiting' && item.wait ? (
          <BotItemWaitCard text={item.wait.text} at={item.wait.at} />
        ) : null}
        {/* Last, as sent: never placed by this machine's clock among the host's events. */}
        {pending?.shown.map((sending) => {
          const { event, failed, intent } = sending
          // Answers on their way show on their question's lines already; words or files beyond them
          // show here.
          if (intent && botItemPendingAnswersOnly(sending)) {
            const shown = quickReplies?.sent?.get(intent.askId)
            const ask = entries.find(
              (entry) => entry.kind === 'comment' && entry.event.id === intent.askId
            )
            if (
              shown &&
              ask?.kind === 'comment' &&
              !ask.onAsk &&
              ask.answers &&
              intent.answers.every(
                (words, index) =>
                  !words ||
                  (shown[index] === words &&
                    (!ask.answers?.[index] ||
                      (intent.shape.decisions.length > 1 && ask.byOrder?.[index])))
              )
            ) {
              return null
            }
          }
          return (
            <BotItemCommentCard
              key={event.id}
              bot={bot}
              item={item}
              entry={{ event }}
              failed={
                failed
                  ? {
                      retry: () => pending.retry(event.id),
                      discard: () => pending.discard(event.id)
                    }
                  : undefined
              }
            />
          )
        })}
      </div>
      {entries.some((entry) => entry.kind !== 'worker' && entry.kind !== 'event') ||
      pending?.shown.length ? null : (
        <p className="pt-0.5 text-xs leading-[18px] text-muted-foreground">
          {t('bots.items.activity.noComments', 'No comments yet.')}
        </p>
      )}
    </>
  )
}
