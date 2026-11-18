// Approval triage (FORK.md, SLRM-2397): "Allow N low risk" over a coordinator's pinned worker
// prompts. Each prompt is graded again at the click, from what it says then, and only a prompt
// that is still open, still offers Allow and is still low is allowed. Medium and high stay one
// at a time. Off unless both forkApprovalRisk and forkApprovalBulkAllowLow are on.
import React from 'react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { gradeForkApproval } from '../../../../shared/fork/approval-risk'
import type { OrchestrationWorkerApprovalEntry } from '../../../../shared/orchestration/orchestration-crew'
import { forkWorkerApprovalCwd, useForkApprovalBulkAllowOn } from './fork-approval-triage'

/** The prompts that may be allowed in bulk right now. */
export function forkLowRiskWorkerApprovals(
  entries: readonly OrchestrationWorkerApprovalEntry[],
  cwdOf: (entry: OrchestrationWorkerApprovalEntry) => string | null = forkWorkerApprovalCwd
): OrchestrationWorkerApprovalEntry[] {
  return entries.filter(({ approval, ...entry }) => {
    if (approval.state !== 'open' || !approval.allowedActions.includes('allow')) {
      return false
    }
    const grade = gradeForkApproval({
      title: approval.summary.title,
      detail: approval.summary.detail,
      cwd: cwdOf({ approval, ...entry })
    })
    return grade.risk === 'low'
  })
}

export function ForkApprovalBulkAllow({
  entries,
  pending,
  onAllow
}: {
  entries: readonly OrchestrationWorkerApprovalEntry[]
  /** Prompts already being answered: never sent twice. */
  pending: { has: (approvalId: string) => boolean }
  onAllow: (entry: OrchestrationWorkerApprovalEntry) => void
}): React.JSX.Element | null {
  const t = useTranslate()
  const on = useForkApprovalBulkAllowOn()
  if (!on) {
    return null
  }
  const low = forkLowRiskWorkerApprovals(entries).filter(
    (entry) => !pending.has(entry.approval.approvalId)
  )
  if (low.length === 0) {
    return null
  }
  return (
    <div
      data-fork-approval-bulk=""
      className="mx-auto flex w-full max-w-(--chat-content-max-width) items-center gap-2 px-3 pt-2 text-xs text-muted-foreground sm:px-4"
    >
      <span className="min-w-0 flex-1 truncate">
        {t('fork.approvalTriage.bulkCount', '{{count}} low risk approvals', { count: low.length })}
      </span>
      <Button
        type="button"
        variant="outline"
        size="xs"
        onClick={() => {
          // Graded again now: a prompt that changed or closed since the render is left alone.
          for (const entry of forkLowRiskWorkerApprovals(entries)) {
            if (!pending.has(entry.approval.approvalId)) {
              onAllow(entry)
            }
          }
        }}
      >
        {t('fork.approvalTriage.bulkAllow', 'Allow low risk')}
      </Button>
    </div>
  )
}
