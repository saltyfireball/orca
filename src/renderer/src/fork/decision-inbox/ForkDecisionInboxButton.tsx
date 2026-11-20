// Decision inbox (FORK.md "Idle recovery"), item E2: the sidebar toolbar button that opens the
// dialog, with the count of chats waiting on the user.
// Contract: returns null while `forkIdleSweepMode` is 'off', the board is off and no bot asks
// anything, so the toolbar is unchanged.
import React from 'react'
import { Inbox } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslate } from '@/i18n/use-translate'
import {
  forkIdleRecoveryBridge,
  openForkDecisionInbox,
  useForkDecisionInbox,
  useForkDecisionInboxBotAsks,
  useForkDecisionInboxOn
} from './decision-inbox-store'
import {
  decisionInboxBadgeText,
  decisionInboxSections,
  decisionInboxWaitingCount
} from './decision-inbox-view'
import { useForkBoard, useForkBoardEnabled } from '../letters/board-store'

function Counted({
  recovery,
  board,
  botAsks
}: {
  recovery: boolean
  board: boolean
  botAsks: number
}): React.JSX.Element {
  const t = useTranslate()
  const { result } = useForkDecisionInbox(recovery)
  const sections = decisionInboxSections(result?.items)
  // Agents a guard paused wait on the user too (SLRM-2385), the board's open asks (SLRM-2389)
  // and bot asks (SLRM-2453).
  const asks = useForkBoard(board).view?.asks.length ?? 0
  const waiting = decisionInboxWaitingCount(sections, asks, botAsks)
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
  const board = useForkBoardEnabled()
  const recovery = on && forkIdleRecoveryBridge() !== null
  // Bot asks are read by the always-mounted watcher; the button shows while any waits (SLRM-2453).
  const botAsks = useForkDecisionInboxBotAsks().length
  // The counts are read only inside `Counted`, so nothing is read while the inbox and the board are off.
  return recovery || board || botAsks > 0 ? (
    <Counted recovery={recovery} board={board} botAsks={botAsks} />
  ) : null
}
