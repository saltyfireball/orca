// Best of N (FORK.md, SLRM-2393): one attempt's column in the compare view: its agent and host,
// state, diff against its base, tests and checks, cost, its own report, and what the pick did.
import type React from 'react'
import { Button } from '@/components/ui/button'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import { activateAndRevealWorktreeWithOutcome } from '@/lib/workspace/activation/worktree-activation'
import type { ExecutionHostId } from '../../../../shared/execution-host/execution-host'
import {
  forkBestOfAgentLabel,
  type ForkBestOfAttempt,
  type ForkBestOfCheckState
} from '../../../../shared/fork/best-of/best-of'
import type { ForkBestOfDiffResult } from '../../../../shared/fork/best-of/best-of-compare'
import type { ForkBestOfAttemptFacts } from '../../../../shared/fork/best-of/best-of-wire'
import { formatForkTokens } from '../../../../shared/fork/usage-ledger'
import { formatForkUsd } from '../../../../shared/fork/usage-report'

const MAX_FILES = 12

function checkWord(state: ForkBestOfCheckState, t: Translate): string {
  switch (state) {
    case 'pass':
      return t('fork.bestOf.checkPass', 'pass')
    case 'fail':
      return t('fork.bestOf.checkFail', 'fail')
    case 'not-run':
      return t('fork.bestOf.checkNotRun', 'not run')
    case 'unknown':
      return t('fork.bestOf.checkUnknown', 'not reported')
  }
}

function costText(facts: ForkBestOfAttemptFacts, t: Translate): string {
  const cost = facts.cost
  if (!cost) {
    return t('fork.bestOf.costNone', 'not counted (only native Claude chats on this machine)')
  }
  if (cost.costUsd === null && cost.subscriptionTokens > 0) {
    return t('fork.bestOf.costSubscription', 'subscription, {{tokens}} tokens', {
      tokens: formatForkTokens(cost.totalTokens)
    })
  }
  return t('fork.bestOf.costEstimate', '{{cost}} estimate, {{tokens}} tokens', {
    cost: `${formatForkUsd(cost.costUsd)}${cost.unpricedTokens > 0 ? ' +?' : ''}`,
    tokens: formatForkTokens(cost.totalTokens)
  })
}

function hostId(facts: ForkBestOfAttemptFacts): ExecutionHostId | undefined {
  return facts.environmentId ? (`runtime:${facts.environmentId}` as ExecutionHostId) : undefined
}

/** Opens the attempt's workspace, then its committed changes in the stock combined diff. */
function openAttempt(facts: ForkBestOfAttemptFacts, diff: ForkBestOfDiffResult | undefined) {
  if (!facts.worktreeId) {
    return false
  }
  const outcome = activateAndRevealWorktreeWithOutcome(facts.worktreeId, {
    navigationIntent: 'user-open',
    executionHostId: hostId(facts)
  })
  if ('refused' in outcome) {
    return false
  }
  if (diff && 'diff' in diff) {
    const state = useAppStore.getState()
    const worktree = state.getKnownWorktreeById(facts.worktreeId, hostId(facts))
    if (worktree) {
      state.openBranchAllDiffs(facts.worktreeId, worktree.path, diff.diff.summary)
    }
  }
  return true
}

function DiffBlock({ diff }: { diff: ForkBestOfDiffResult | undefined }): React.JSX.Element {
  const t = useTranslate()
  if (!diff) {
    return (
      <p className="text-xs text-muted-foreground">
        {t('fork.bestOf.diffLoading', 'Reading the diff...')}
      </p>
    )
  }
  if ('pending' in diff) {
    return (
      <p className="text-xs text-muted-foreground">
        {t('fork.bestOf.diffPending', 'No worktree yet.')}
      </p>
    )
  }
  if ('error' in diff) {
    return (
      <p className="text-xs text-muted-foreground">
        {t('fork.bestOf.diffFailed', 'Diff unavailable: {{error}}', { error: diff.error })}
      </p>
    )
  }
  const { files, added, removed, baseRef, uncommitted, entries } = diff.diff
  return (
    <div className="space-y-1">
      <p className="text-xs">
        {t('fork.bestOf.diffSummary', '{{files}} files, +{{added}} -{{removed}} vs {{base}}', {
          files,
          added,
          removed,
          base: baseRef
        })}
        {uncommitted ? (
          <span className="text-muted-foreground">
            {' '}
            {t('fork.bestOf.uncommitted', '({{count}} uncommitted)', { count: uncommitted })}
          </span>
        ) : null}
      </p>
      {entries.length > 0 ? (
        <ul className="scrollbar-sleek max-h-28 overflow-y-auto font-mono text-[11px] text-muted-foreground">
          {entries.slice(0, MAX_FILES).map((entry) => (
            <li key={entry.path} className="flex gap-2">
              <span className="min-w-0 flex-1 truncate" title={entry.path}>
                {entry.path}
              </span>
              <span className="tabular-nums">
                +{entry.added ?? 0} -{entry.removed ?? 0}
              </span>
            </li>
          ))}
          {entries.length > MAX_FILES ? (
            <li>
              {t('fork.bestOf.moreFiles', '{{count}} more', { count: entries.length - MAX_FILES })}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}

export function ForkBestOfAttemptCard(props: {
  attempt: ForkBestOfAttempt
  facts: ForkBestOfAttemptFacts | undefined
  diff: ForkBestOfDiffResult | undefined
  winner: number | undefined
  canPick: boolean
  onPick: (index: number) => void
  onOpenFailed: () => void
}): React.JSX.Element {
  const { attempt, facts, diff, winner } = props
  const t = useTranslate()
  const host =
    facts?.hostLabel ??
    (attempt.host === 'here' ? t('fork.bestOf.thisMachine', 'this machine') : attempt.host)
  const state = facts?.taskStatus ?? facts?.workerState ?? (attempt.startError ? 'failed' : '-')
  const error = facts?.workerError ?? attempt.startError
  const isWinner = winner === attempt.index
  return (
    <div
      className={`flex min-w-0 flex-col gap-2 rounded-lg border p-3 text-sm ${isWinner ? 'border-primary' : 'border-border'}`}
    >
      <div className="min-w-0">
        <div className="truncate font-medium">
          #{attempt.index} {forkBestOfAgentLabel(attempt)}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {t('fork.bestOf.hostState', '{{host}}, {{state}}', { host, state })}
        </div>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <DiffBlock diff={diff} />
      {facts ? (
        <>
          <p className="text-xs">
            {t('fork.bestOf.checks', 'Tests {{tests}}, checks {{checks}}', {
              tests: checkWord(facts.checks.tests, t),
              checks: checkWord(facts.checks.checks, t)
            })}
          </p>
          <p className="text-xs text-muted-foreground">{costText(facts, t)}</p>
          <div className="scrollbar-sleek max-h-40 min-h-0 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2 text-xs">
            {facts.report ?? t('fork.bestOf.noReport', 'No report yet.')}
          </div>
        </>
      ) : null}
      {attempt.outcome ? (
        <p className="text-xs text-muted-foreground">
          {attempt.outcome.kind === 'kept'
            ? t('fork.bestOf.kept', 'Kept')
            : attempt.outcome.kind === 'archived'
              ? t('fork.bestOf.archived', 'Archived')
              : attempt.outcome.kind === 'removed'
                ? t('fork.bestOf.removed', 'Removed')
                : attempt.outcome.kind === 'left'
                  ? t('fork.bestOf.left', 'Left as it is')
                  : t('fork.bestOf.outcomeFailed', 'Not archived: {{error}}', {
                      error: attempt.outcome.message ?? ''
                    })}
        </p>
      ) : null}
      <div className="mt-auto flex flex-wrap gap-1 pt-1">
        <Button
          size="sm"
          variant="outline"
          disabled={!facts?.worktreeId}
          onClick={() => {
            if (facts && !openAttempt(facts, diff)) {
              props.onOpenFailed()
            }
          }}
        >
          {t('fork.bestOf.open', 'Open')}
        </Button>
        {props.canPick ? (
          <Button size="sm" variant="secondary" onClick={() => props.onPick(attempt.index)}>
            {t('fork.bestOf.pick', 'Keep this one')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
