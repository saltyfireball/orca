// Decision inbox (FORK.md "Idle recovery"), item E2: the sidebar toolbar button that opens the
// dialog, with the count of chats waiting on the user.
// Contract: returns null while `forkIdleSweepMode` is 'off', so the toolbar is unchanged.
import React from 'react'
import { Inbox } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslate } from '@/i18n/use-translate'
import {
  forkIdleRecoveryBridge,
  openForkDecisionInbox,
  useForkDecisionInbox,
  useForkDecisionInboxOn
} from './decision-inbox-store'
import { decisionInboxBadgeText, decisionInboxSections } from './decision-inbox-view'

function Counted(): React.JSX.Element {
  const t = useTranslate()
  const { result } = useForkDecisionInbox(true)
  const sections = decisionInboxSections(result?.items)
  const waiting = sections.waiting.length
  const stalled = sections.stalled.length
  const label =
    waiting === 0 && stalled === 0
      ? t('fork.decisionInbox.button', 'Decision inbox: nothing is waiting on you')
      : stalled === 0
        ? t('fork.decisionInbox.buttonWaiting', 'Decision inbox: {{waiting}} waiting on you', {
            waiting
          })
        : t(
            'fork.decisionInbox.buttonBoth',
            'Decision inbox: {{waiting}} waiting on you, {{stalled}} stalled',
            { waiting, stalled }
          )
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          type="button"
          aria-label={label}
          onClick={openForkDecisionInbox}
          className="px-1.5 text-muted-foreground"
        >
          <Inbox className="size-3.5" />
          {waiting > 0 ? (
            <span
              data-decision-inbox-count="waiting"
              className="min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 font-semibold text-primary-foreground tabular-nums"
            >
              {decisionInboxBadgeText(waiting)}
            </span>
          ) : null}
          {stalled > 0 ? (
            <span
              data-decision-inbox-count="stalled"
              className="min-w-4 rounded-full border border-border px-1 text-center text-[10px] leading-[14px] text-muted-foreground tabular-nums"
            >
              {decisionInboxBadgeText(stalled)}
            </span>
          ) : null}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function ForkDecisionInboxButton(): React.JSX.Element | null {
  const on = useForkDecisionInboxOn()
  // The counts are read only inside `Counted`, so nothing is read while the inbox is off.
  return !on || !forkIdleRecoveryBridge() ? null : <Counted />
}
