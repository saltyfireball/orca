// SLRM-2390 (FORK.md "Row status"): chips on an agent row: the chat's spend and context size from
// the usage ledger (SLRM-2103/2104), the workspace's pull request colored by its checks, and an
// "Ask agent to fix" button while they fail. Every part reads a store the app already keeps (the
// ledger push, the PR caches the stock watcher fills), so a row adds no polling or timers.
import React, { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Wrench } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { STATE_INDICATOR_TOOLTIP_DELAY_MS } from '@/components/StateIndicatorTooltip'
import { cn } from '@/lib/class-names'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import {
  ReviewIcon,
  getReviewLabel
} from '@/components/sidebar/workspace-card/review/worktree-review-presentation'
import { checksLabel } from '@/components/sidebar/workspace-card/review/workspace-review-check-label'
import { reviewStateLabel } from '@/components/sidebar/workspace-card/metadata/WorktreeCardMetadataStatusBadges'
import type { WorktreeCardPrDisplay } from '@/components/sidebar/workspace-card/review/worktree-card-pr-display'
import {
  getProviderChecksOutcome,
  type CheckPresentationOutcome
} from '../../../../shared/source-control/checks/provider-check-summary'
import { resolveSourceControlAiEnabled } from '../../../../shared/source-control/ai/source-control-ai-operation-policy'
import { formatContextTokenCount } from '../../../../shared/native-chat/native-chat-context-usage-summary'
import { formatForkUsd } from '../../../../shared/fork/usage-report'
import type { ForkCacheState } from '../../../../shared/fork/usage-ledger'
import { forkRowStatusConfig } from '../../../../shared/fork/row-status'
import { chatSessionIdForRow } from '../cache-cold/cache-cold-view'
import { useCacheState } from '../cache-cold/use-fork-cache-cold'
import { useForkRowReview } from './use-fork-row-review'
import { forkAskAgentToFixChecks } from './fork-row-fix-checks'

type Row = { paneKey: string; tab: { id: string; worktreeId: string }; rowSource?: string }

/** The child count badge's chip (SLRM-2095), so every fork chip on a row looks the same. */
function chipClass(highlighted: boolean): string {
  return cn(
    'inline-flex shrink-0 items-center gap-0.5 rounded-sm border px-0.5 text-[10px] leading-[12px] tabular-nums',
    highlighted
      ? 'border-foreground/25 text-foreground/70'
      : 'border-worktree-sidebar-border/70 text-muted-foreground/70'
  )
}

function Chip({
  label,
  highlighted,
  children,
  data
}: {
  label: string
  highlighted: boolean
  children: React.ReactNode
  data: string
}): React.JSX.Element {
  return (
    <Tooltip delayDuration={STATE_INDICATOR_TOOLTIP_DELAY_MS}>
      <TooltipTrigger asChild>
        <span aria-label={label} className={chipClass(highlighted)} data-fork-row-status={data}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4} className="max-w-72">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

/** Visible text and tooltip for a chat's spend; null when nothing has a price yet. */
export function forkSpendText(
  state: Pick<ForkCacheState, 'costUsd' | 'unpriced' | 'billing'>,
  t: Translate
): { text: string; label: string } | null {
  if (state.costUsd === undefined) {
    return null
  }
  const amount = `${formatForkUsd(state.costUsd)}${state.unpriced ? '+' : ''}`
  const subscription = state.billing === 'subscription'
  const label = subscription
    ? t(
        'fork.rowStatus.spendSubscription',
        'Subscription: not billed per token. At API prices this chat has used about {{amount}}.',
        { amount }
      )
    : t('fork.rowStatus.spend', 'Estimated spend of this chat: {{amount}}.', { amount })
  return {
    text: subscription ? `~${amount}` : amount,
    label: state.unpriced
      ? `${label} ${t('fork.rowStatus.spendUnpriced', 'Some models have no price, so it is more.')}`
      : label
  }
}

/** The review's check state, as the workspace card's checks indicator names it. */
export function forkRowChecksOutcome(
  review: WorktreeCardPrDisplay
): CheckPresentationOutcome | undefined {
  return review.status ? getProviderChecksOutcome(review.checksSummary, review.status) : undefined
}

function prChipLabel(review: WorktreeCardPrDisplay, t: Translate): string {
  const kind = getReviewLabel(review)
  const number = `${kind === 'MR' ? '!' : '#'}${review.number}`
  const outcome = forkRowChecksOutcome(review)
  const checks = outcome ? checksLabel(outcome, t) : ''
  const parts = [`${kind} ${number}: ${review.title}`, reviewStateLabel(review.state, kind, t)]
  if (checks) {
    parts.push(
      t('fork.rowStatus.checks', 'Checks: {{status}}', {
        status: checks
      })
    )
  }
  return parts.join(' - ')
}

function FixButton({ row, highlighted }: { row: Row; highlighted: boolean }): React.JSX.Element {
  const t = useTranslate()
  const [busy, setBusy] = useState(false)
  const label = t('fork.rowStatus.fix.label', 'Ask agent to fix')
  return (
    <button
      type="button"
      className={cn(
        chipClass(highlighted),
        'cursor-pointer hover:text-foreground disabled:opacity-50'
      )}
      aria-label={label}
      title={t('fork.rowStatus.fix.help', 'Send the failing checks and their logs to this agent.')}
      disabled={busy}
      data-fork-row-status="fix"
      onClick={(event) => {
        event.stopPropagation()
        setBusy(true)
        void forkAskAgentToFixChecks(row).finally(() => setBusy(false))
      }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <Wrench className="size-2.5" aria-hidden />
      {t('fork.rowStatus.fix.short', 'Fix')}
    </button>
  )
}

/** One line per row (CompactAgentRow, DashboardAgentRow); sub-agent rows show nothing. */
export function ForkAgentRowStatus({
  agent,
  highlighted = false
}: {
  agent: Row
  highlighted?: boolean
}): React.JSX.Element | null {
  const t = useTranslate()
  const top = agent.rowSource !== 'subagent'
  const config = useAppStore(useShallow((s) => forkRowStatusConfig(s.settings)))
  const wantsLedger = top && (config.spend || config.context)
  const sessionId = useAppStore((s) =>
    wantsLedger
      ? chatSessionIdForRow(
          s.unifiedTabsByWorktree[agent.tab.worktreeId],
          agent.tab.id,
          agent.paneKey
        )
      : undefined
  )
  const ledger = useCacheState(sessionId)
  const { review, repo } = useForkRowReview(agent.tab.worktreeId, top && config.pr)
  // The stock switch that hides the Checks panel's AI fix also hides this one.
  const aiActions = useAppStore((s) =>
    review && config.fix ? resolveSourceControlAiEnabled({ settings: s.settings, repo }) : false
  )
  if (!top) {
    return null
  }
  const spend = config.spend && ledger ? forkSpendText(ledger, t) : null
  const context = config.context && ledger && ledger.contextTokens > 0 ? ledger.contextTokens : 0
  const failing =
    review !== null &&
    review.provider === 'github' &&
    (review.state === 'open' || review.state === 'draft') &&
    forkRowChecksOutcome(review) === 'failure'
  if (!spend && !context && !review) {
    return null
  }
  return (
    <>
      {spend ? (
        <Chip label={spend.label} highlighted={highlighted} data="spend">
          {spend.text}
        </Chip>
      ) : null}
      {context ? (
        <Chip
          label={t('fork.rowStatus.context', 'Context: {{tokens}} tokens on the last call.', {
            tokens: formatContextTokenCount(context)
          })}
          highlighted={highlighted}
          data="context"
        >
          {t('fork.rowStatus.contextShort', 'ctx {{tokens}}', {
            tokens: formatContextTokenCount(context)
          })}
        </Chip>
      ) : null}
      {review ? (
        <Chip label={prChipLabel(review, t)} highlighted={highlighted} data="pr">
          <ReviewIcon review={review} className="size-2.5" />
          {`${review.provider === 'gitlab' ? '!' : '#'}${review.number}`}
        </Chip>
      ) : null}
      {failing && aiActions ? <FixButton row={agent} highlighted={highlighted} /> : null}
    </>
  )
}
