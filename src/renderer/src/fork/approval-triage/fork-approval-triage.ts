// Approval triage (FORK.md, SLRM-2397): the window's side of the risk grade. A card is graded
// only where its chat passes a triage context (the chat's own structured prompt and a
// coordinator's worker prompts), and only while `forkApprovalRisk` is on.
import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { findWorktreeById } from '@/store/github/refresh/worktree-refresh'
import { gradeForkApproval, type ForkApprovalGrade } from '../../../../shared/fork/approval-risk'
import type { ChatApproval } from '../../../../shared/native-chat/input/native-chat-interactive-prompt'
import type { AgentJournalApprovalItem } from '../../../../shared/agent-session/journal/agent-session-journal-types'
import type { OrchestrationWorkerApprovalEntry } from '../../../../shared/orchestration/orchestration-crew'

export type ForkApprovalTriage = {
  /** The folder the asking agent works in; null when the window cannot tell. */
  cwd: string | null
  /** Options that allow the same call again for the session; held back on a high risk card. */
  sessionSends?: readonly string[]
}

export function useForkApprovalRiskOn(): boolean {
  return useAppStore((s) => s.settings?.forkApprovalRisk === true)
}

export function useForkApprovalBulkAllowOn(): boolean {
  return useAppStore(
    (s) => s.settings?.forkApprovalRisk === true && s.settings?.forkApprovalBulkAllowLow === true
  )
}

/** Graded only for a tool's approval: a plan, a sign-in page or a startup dialog is not one. */
export function forkGradeApproval(
  approval: ChatApproval,
  triage: ForkApprovalTriage
): ForkApprovalGrade | null {
  if (approval.subject || approval.startupDialog) {
    return null
  }
  return gradeForkApproval({ title: approval.title, detail: approval.detail, cwd: triage.cwd })
}

export function useForkApprovalRisk(
  approval: ChatApproval,
  triage: ForkApprovalTriage | undefined
): ForkApprovalGrade | null {
  const on = useForkApprovalRiskOn()
  const hasTriage = triage !== undefined
  const cwd = triage?.cwd ?? null
  // Grading is a few string checks, so a card redrawn with a new approval object just grades again.
  return useMemo(
    () => (on && hasTriage ? forkGradeApproval(approval, { cwd }) : null),
    [on, hasTriage, cwd, approval]
  )
}

/** A high risk card never allows the same call for the rest of the session. */
export function forkApprovalOptionHeld(
  grade: ForkApprovalGrade | null,
  triage: ForkApprovalTriage | undefined,
  send: string
): boolean {
  return grade?.risk === 'high' && (triage?.sessionSends?.includes(send) ?? false)
}

/** The options of a journal approval that allow the call for the rest of the session. */
export function forkSessionSends(body: AgentJournalApprovalItem): string[] {
  return body.options.filter((option) => option.intent === 'allow_always').map((o) => o.id)
}

/** The folder a worker works in, when its open target names a workspace this window knows. */
export function forkWorkerApprovalCwd(entry: OrchestrationWorkerApprovalEntry): string | null {
  const target = entry.worker.openTarget
  if (target?.kind !== 'chat') {
    return null
  }
  return findWorktreeById(useAppStore.getState(), target.worktreeId)?.path ?? null
}
