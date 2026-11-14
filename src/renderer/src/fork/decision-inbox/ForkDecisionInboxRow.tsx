// Decision inbox (FORK.md "Idle recovery"): one chat in the dialog, with its question, an answer
// box for a chat waiting on the user, and jump and pause. The draft lives in the row, keyed by
// chat, so a live update of the list never drops what is being typed.
import React, { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import {
  FORK_IDLE_RECOVERY_MAX_ANSWER_CHARS,
  type ForkIdleRecoveryInboxItem
} from '../../../../shared/fork/idle-recovery-wire'
import { sleeperAge } from '../sleepers/ForkSleepersRow'

export type DecisionInboxRowActions = {
  /** Resolves true when the answer went to the chat. */
  answer: (item: ForkIdleRecoveryInboxItem, text: string) => Promise<boolean>
  jump: (item: ForkIdleRecoveryInboxItem) => void
  pause: (item: ForkIdleRecoveryInboxItem, paused: boolean) => Promise<void>
}

function detailLine(item: ForkIdleRecoveryInboxItem, now: number, t: Translate): string {
  const parts = [
    item.kind === 'chat'
      ? t('fork.decisionInbox.kind.chat', 'Chat')
      : t('fork.decisionInbox.kind.terminal', 'Terminal'),
    item.agent,
    item.workspace,
    item.paused ? t('fork.decisionInbox.paused', 'recovery paused') : ''
  ]
  if (item.verdict === 'stalled') {
    if (item.wakes > 0) {
      parts.push(t('fork.decisionInbox.wakes', 'woken {{count}} times', { count: item.wakes }))
    }
    if (item.wakeAt !== null && !item.paused) {
      parts.push(
        item.wakeAt <= now
          ? t('fork.decisionInbox.wakeDue', 'wake due')
          : t('fork.decisionInbox.wakeIn', 'next wake in {{age}}', {
              age: sleeperAge(item.wakeAt - now, t)
            })
      )
    }
  }
  return parts.filter(Boolean).join(' - ')
}

export function ForkDecisionInboxRow({
  item,
  now,
  actions
}: {
  item: ForkIdleRecoveryInboxItem
  now: number
  actions: DecisionInboxRowActions
}): React.JSX.Element {
  const t = useTranslate()
  const questionId = useId()
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [pausing, setPausing] = useState(false)
  const waiting = item.verdict === 'waiting_user'
  const body = (waiting ? item.question : item.reason).trim()
  const text = draft.trim()

  const send = (): void => {
    if (!text || sending) {
      return
    }
    setSending(true)
    void actions
      .answer(item, text)
      .then((sent) => {
        if (sent) {
          setDraft('')
        }
      })
      .finally(() => setSending(false))
  }
  const togglePause = (): void => {
    setPausing(true)
    void actions.pause(item, !item.paused).finally(() => setPausing(false))
  }
  const answerLabel = t('fork.decisionInbox.answerLabel', 'Answer to {{title}}', {
    title: item.title
  })

  return (
    <li className="flex flex-col gap-2 border-b border-border/50 py-3 text-sm last:border-b-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{item.title}</div>
          <div className="truncate text-xs text-muted-foreground">{detailLine(item, now, t)}</div>
        </div>
        <div
          className="shrink-0 text-right text-xs text-muted-foreground"
          title={t('fork.decisionInbox.sinceTitle', 'Waiting for {{age}}', {
            age: sleeperAge(now - item.since, t)
          })}
        >
          {sleeperAge(now - item.since, t)}
        </div>
      </div>
      {body ? (
        <p
          id={questionId}
          className="scrollbar-sleek max-h-40 overflow-y-auto break-words whitespace-pre-wrap text-foreground select-text"
        >
          {body}
        </p>
      ) : null}
      {waiting ? (
        <Textarea
          className="min-h-14"
          rows={2}
          aria-label={answerLabel}
          aria-describedby={body ? questionId : undefined}
          placeholder={t(
            'fork.decisionInbox.answerPlaceholder',
            'Your answer. Enter sends, Shift+Enter adds a line.'
          )}
          maxLength={FORK_IDLE_RECOVERY_MAX_ANSWER_CHARS}
          disabled={sending}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              send()
            }
          }}
        />
      ) : null}
      <div className="flex flex-wrap justify-end gap-1">
        <Button size="sm" variant="ghost" disabled={pausing} onClick={togglePause}>
          {item.paused
            ? t('fork.decisionInbox.resume', 'Resume recovery')
            : t('fork.decisionInbox.pause', 'Pause recovery')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => actions.jump(item)}>
          {t('fork.decisionInbox.jump', 'Go to chat')}
        </Button>
        {waiting ? (
          <Button size="sm" disabled={!text || sending} onClick={send}>
            {t('fork.decisionInbox.send', 'Send')}
          </Button>
        ) : null}
      </div>
    </li>
  )
}
