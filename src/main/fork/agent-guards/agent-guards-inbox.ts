// Agent guards (FORK.md, SLRM-2385) in the Decision inbox (SLRM-2196): paused agents as inbox
// rows, the inbox's answer to one (lift the pause, then send the text) and its Resume.
import type {
  ForkIdleRecoveryAnswerOutcome,
  ForkIdleRecoveryInboxItem
} from '../../../shared/fork/idle-recovery-wire'
import { agentGuardReasonText } from '../../../shared/fork/agent-guards'
import { sendIdleRecoveryAnswer } from '../idle-recovery/idle-recovery-wake'
import {
  forkAgentGuardEntries,
  forkAgentGuardIsPaused,
  forkAgentGuardResumeIfPaused,
  onForkAgentGuardPausesChanged
} from './agent-guards-service'

export { onForkAgentGuardPausesChanged }

/** Paused agents as Decision inbox rows. */
export function forkAgentGuardInboxItems(): ForkIdleRecoveryInboxItem[] {
  return forkAgentGuardEntries()
    .filter((entry) => entry.state === 'paused')
    .map((entry) => ({
      chatId: entry.id,
      kind: entry.kind,
      agent: entry.agent,
      title: entry.title || entry.agent,
      workspace: '',
      worktreeId: entry.worktreeId,
      verdict: 'guard' as const,
      question: '',
      reason: agentGuardReasonText(entry),
      since: entry.since,
      wakes: 0,
      wakeAt: null,
      paused: false
    }))
}

export function forkAgentGuardPaused(chatId: string): boolean {
  return forkAgentGuardIsPaused(chatId)
}

/** The inbox's Resume on a guard's row. */
export async function forkAgentGuardInboxResume(chatId: string): Promise<void> {
  await forkAgentGuardResumeIfPaused(chatId)
}

/** The inbox's answer to a paused agent: lift the pause, then send the person's text. */
export async function forkAgentGuardAnswer(
  chatId: string,
  text: string
): Promise<ForkIdleRecoveryAnswerOutcome> {
  const entry = forkAgentGuardEntries().find((item) => item.id === chatId)
  if (!entry || !(await forkAgentGuardResumeIfPaused(chatId))) {
    return 'not-found'
  }
  return sendIdleRecoveryAnswer(chatId, text, { kind: entry.kind, agent: entry.agent })
}

/** The guard rows first; a chat idle recovery also lists shows once, as the guard's. */
export function withForkAgentGuardRows(
  guarded: ForkIdleRecoveryInboxItem[],
  items: ForkIdleRecoveryInboxItem[]
): ForkIdleRecoveryInboxItem[] {
  const ids = new Set(guarded.map((item) => item.chatId))
  return [...guarded, ...items.filter((item) => !ids.has(item.chatId))]
}
