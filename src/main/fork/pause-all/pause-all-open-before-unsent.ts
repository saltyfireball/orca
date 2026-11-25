// Pause all over chat worker launches across a restart (BAD-818), in the journal writer. Whatever a
// chat accepted before its opening point belongs to an earlier process: its unsent messages are
// failed and never handed over. A held launch's chat opens just before the first message it never
// sent instead, so that message is this process's own and the start hands it over. A chat with a
// message already handed over and unanswered opens where upstream opens it.
import type Database from '../../sqlite/sync-database'
import type { AgentJournalCursor } from '../../../shared/agent-session/journal/agent-session-journal-identity'
import { isQueuedAgentJournalSubmission } from '../../../shared/agent-session/requests/agent-session-queued-submission'
import { recoverableSubmissions } from '../../native-chat/agent-session-journal/journal-domain-input-recovery'

export function forkOpenBeforeUnsent(
  db: Database.Database,
  target: { sessionId: string; epoch: string },
  opened: AgentJournalCursor
): AgentJournalCursor {
  const unsettled = recoverableSubmissions(db, target)
  if (
    unsettled.length === 0 ||
    !unsettled.every(({ submission }) => isQueuedAgentJournalSubmission(submission))
  ) {
    return opened
  }
  const first = Math.min(
    ...unsettled.map(({ submission, attemptSequence }) =>
      Math.min(attemptSequence, submission.acceptedSequence ?? attemptSequence)
    )
  )
  return { ...opened, sequence: Math.min(opened.sequence, first - 1) }
}
