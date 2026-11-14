// Decision inbox (FORK.md "Idle recovery"), item E2: the always-mounted host of the dialog
// that lists chats waiting on the user, with answer and pause.
// Contract: renders nothing, reads nothing and subscribes to nothing while `forkIdleSweepMode`
// is 'off'; the dialog reads `window.api.forkIdleRecovery` only once it is opened.
import React, { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useTranslate } from '@/i18n/use-translate'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import type { ForkIdleRecoveryInboxItem } from '../../../../shared/fork/idle-recovery-wire'
import {
  answerDecisionInboxChat,
  jumpToDecisionInboxChat,
  setDecisionInboxChatPaused
} from './decision-inbox-actions'
import {
  closeForkDecisionInbox,
  useForkDecisionInbox,
  useForkDecisionInboxOpen,
  useForkIdleRecoveryMode
} from './decision-inbox-store'
import { decisionInboxNow, decisionInboxSections } from './decision-inbox-view'
import { ForkDecisionInboxRow, type DecisionInboxRowActions } from './ForkDecisionInboxRow'

/** How often an open dialog redraws its ages. A clock tick only: it reads nothing. */
const AGE_TICK_MS = 30_000

const ACTIONS: DecisionInboxRowActions = {
  answer: answerDecisionInboxChat,
  jump: (item) => {
    if (jumpToDecisionInboxChat(item)) {
      closeForkDecisionInbox()
    }
  },
  pause: setDecisionInboxChatPaused
}

function Section({
  title,
  items,
  now
}: {
  title: string
  items: readonly ForkIdleRecoveryInboxItem[]
  now: number
}): React.JSX.Element | null {
  if (items.length === 0) {
    return null
  }
  return (
    <section aria-label={title}>
      <h3 className="text-xs font-medium text-muted-foreground">
        {title} ({items.length})
      </h3>
      <ul>
        {items.map((item) => (
          <ForkDecisionInboxRow key={item.chatId} item={item} now={now} actions={ACTIONS} />
        ))}
      </ul>
    </section>
  )
}

function Body(): React.JSX.Element {
  const t = useTranslate()
  const { result, receivedAt, error } = useForkDecisionInbox(true)
  const [localNow, setLocalNow] = useState(() => Date.now())
  useEffect(
    () =>
      installWindowVisibilityInterval({
        run: () => setLocalNow(Date.now()),
        intervalMs: AGE_TICK_MS
      }),
    []
  )
  if (!result) {
    return error ? (
      <p className="text-sm text-destructive">{error}</p>
    ) : (
      <p className="text-sm text-muted-foreground">
        {t('fork.decisionInbox.loading', 'Loading...')}
      </p>
    )
  }
  const { waiting, stalled, paused } = decisionInboxSections(result.items)
  const now = decisionInboxNow(result, receivedAt, Math.max(localNow, receivedAt))
  return (
    <div
      className="scrollbar-sleek flex min-h-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto"
      aria-live="polite"
    >
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {waiting.length === 0 && stalled.length === 0 && paused.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t('fork.decisionInbox.empty', 'Nothing is waiting on you.')}
        </p>
      ) : null}
      <Section
        title={t('fork.decisionInbox.waitingTitle', 'Waiting on you')}
        items={waiting}
        now={now}
      />
      <Section title={t('fork.decisionInbox.stalledTitle', 'Stalled')} items={stalled} now={now} />
      <Section title={t('fork.decisionInbox.pausedTitle', 'Paused')} items={paused} now={now} />
    </div>
  )
}

export function ForkDecisionInboxHost(): React.JSX.Element | null {
  const t = useTranslate()
  const mode = useForkIdleRecoveryMode()
  const isOpen = useForkDecisionInboxOpen()
  const off = mode === 'off'
  useEffect(() => {
    // Switched off while open: close, so turning it on again does not pop the dialog back up.
    if (off && isOpen) {
      closeForkDecisionInbox()
    }
  }, [off, isOpen])
  if (off || !isOpen) {
    return null
  }
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) {
          closeForkDecisionInbox()
        }
      }}
    >
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('fork.decisionInbox.title', 'Decision inbox')}</DialogTitle>
          <DialogDescription>
            {mode === 'wake'
              ? t(
                  'fork.decisionInbox.descriptionWake',
                  'Chats whose last turn ended on a question for you, and stalled chats idle recovery will wake. Answer here or go to the chat.'
                )
              : t(
                  'fork.decisionInbox.descriptionInbox',
                  'Chats whose last turn ended on a question for you, and chats that stalled on work they could do now. Answer here or go to the chat.'
                )}
          </DialogDescription>
        </DialogHeader>
        <Body />
      </DialogContent>
    </Dialog>
  )
}
