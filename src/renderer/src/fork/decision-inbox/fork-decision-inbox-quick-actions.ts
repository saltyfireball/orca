// Decision inbox (FORK.md "Idle recovery"), item E2: the command palette entry that opens the
// dialog. Contract: returns no entry while `forkIdleSweepMode` is 'off'.
import type { CmdJQuickAction } from '@/components/cmd-j/quick-actions'

export function getForkDecisionInboxQuickActions(): CmdJQuickAction[] {
  return []
}
