// Approval triage (FORK.md, SLRM-2397): everything `NativeChatApprovalCard` takes from the fork in
// one hook, so the stock card carries one import and a few short lines. `line` is the grade under
// the title; `hold(send, disabled)` adds the high-risk hold on the allow-for-session options.
import React from 'react'
import { ForkApprovalRiskLine } from './ForkApprovalRiskLine'
import {
  forkApprovalOptionHeld,
  useForkApprovalRisk,
  type ForkApprovalTriage
} from './fork-approval-triage'
import type { ChatApproval } from '../../../../shared/native-chat/input/native-chat-interactive-prompt'

export type { ForkApprovalTriage }

export function useForkApprovalCard(
  approval: ChatApproval,
  triage: ForkApprovalTriage | undefined
): { line: React.JSX.Element; hold: (send: string, disabled: boolean) => boolean } {
  const grade = useForkApprovalRisk(approval, triage)
  return {
    line: <ForkApprovalRiskLine grade={grade} />,
    hold: (send, disabled) => disabled || forkApprovalOptionHeld(grade, triage, send)
  }
}
