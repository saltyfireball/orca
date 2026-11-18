// Agent guards (FORK.md, SLRM-2385) in the Decision inbox (SLRM-2196): paused agents as inbox
// rows, the inbox's answer to one (lift the pause, then send the text) and its Resume, laid over
// idle recovery's inbox service by `withForkAgentGuardInbox`.
import type {
  ForkIdleRecoveryAnswerOutcome,
  ForkIdleRecoveryAnswerRequest,
  ForkIdleRecoveryAnswerResult,
  ForkIdleRecoveryInboxItem,
  ForkIdleRecoveryInboxResult,
  ForkIdleRecoveryPauseRequest,
  ForkIdleRecoveryPauseResult
} from '../../../shared/fork/idle-recovery-wire'
import { agentGuardReasonText } from '../../../shared/fork/agent-guards'
import { sendIdleRecoveryAnswer } from '../idle-recovery/idle-recovery-wake'
import {
  forkAgentGuardEntries,
  forkAgentGuardIsPaused,
  forkAgentGuardResumeIfPaused,
  onForkAgentGuardPausesChanged
} from './agent-guards-service'

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

/** The inbox's answer to a paused agent: lift the pause, then send the person's text. */
async function answerPaused(chatId: string, text: string): Promise<ForkIdleRecoveryAnswerOutcome> {
  const entry = forkAgentGuardEntries().find((item) => item.id === chatId)
  if (!entry || !(await forkAgentGuardResumeIfPaused(chatId))) {
    return 'not-found'
  }
  return sendIdleRecoveryAnswer(chatId, text, { kind: entry.kind, agent: entry.agent })
}

/** The guard rows first; a chat idle recovery also lists shows once, as the guard's. Rows of
 *  another source (the PR babysitter) are kept as they are. */
export function withForkAgentGuardRows(
  guarded: ForkIdleRecoveryInboxItem[],
  items: ForkIdleRecoveryInboxItem[]
): ForkIdleRecoveryInboxItem[] {
  const ids = new Set(guarded.map((item) => item.chatId))
  return [...guarded, ...items.filter((item) => item.source || !ids.has(item.chatId))]
}

type InboxService = {
  listInbox: () => Promise<ForkIdleRecoveryInboxResult>
  answer: (request: ForkIdleRecoveryAnswerRequest) => Promise<ForkIdleRecoveryAnswerResult>
  setPaused: (request: ForkIdleRecoveryPauseRequest) => Promise<ForkIdleRecoveryPauseResult>
  onChanged: (listener: () => void) => () => void
}

/** Idle recovery's inbox service with the guard's rows: listed whatever the mode, an answer to
 *  one goes to the guard and so does its Resume, and a pause starting or ending is a change. */
export function withForkAgentGuardInbox<S extends InboxService>(
  service: S,
  pausedCount: () => number
): S {
  const guarded = (request: { chatId: string; source?: string }): boolean =>
    !request.source && forkAgentGuardIsPaused(request.chatId)
  return {
    ...service,
    async listInbox() {
      const result = await service.listInbox()
      return { ...result, items: withForkAgentGuardRows(forkAgentGuardInboxItems(), result.items) }
    },
    async answer(request) {
      return guarded(request)
        ? { chatId: request.chatId, result: await answerPaused(request.chatId, request.text) }
        : service.answer(request)
    },
    async setPaused(request) {
      if (request.paused || !guarded(request)) {
        return service.setPaused(request)
      }
      await forkAgentGuardResumeIfPaused(request.chatId)
      return { chatId: request.chatId, paused: false, pausedCount: pausedCount(), saved: true }
    },
    onChanged(listener) {
      const stopService = service.onChanged(listener)
      const stopGuards = onForkAgentGuardPausesChanged(listener)
      return () => {
        stopService()
        stopGuards()
      }
    }
  }
}
