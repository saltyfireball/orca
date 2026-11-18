// Approval triage (FORK.md, SLRM-2397): the grade line under an approval card's title, a stock
// Badge (outline for low, warning for medium, destructive for high) and the reason in a few words.
import React from 'react'
import { Badge } from '@/components/ui/badge'
import { useTranslate } from '@/i18n/use-translate'
import type { ForkApprovalGrade } from '../../../../shared/fork/approval-risk'

const VARIANT = { low: 'outline', medium: 'warning', high: 'destructive' } as const

export function ForkApprovalRiskLine({
  grade
}: {
  grade: ForkApprovalGrade | null
}): React.JSX.Element | null {
  const t = useTranslate()
  if (!grade) {
    return null
  }
  const label =
    grade.risk === 'low'
      ? t('fork.approvalTriage.low', 'Low risk')
      : grade.risk === 'medium'
        ? t('fork.approvalTriage.medium', 'Medium risk')
        : t('fork.approvalTriage.high', 'High risk')
  return (
    <p
      data-fork-approval-risk={grade.risk}
      className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
    >
      <Badge variant={VARIANT[grade.risk]} className="h-4 px-1.5 py-0 text-[10px]">
        {label}
      </Badge>
      <span className="truncate" title={grade.reason}>
        {grade.reason}
      </span>
    </p>
  )
}
