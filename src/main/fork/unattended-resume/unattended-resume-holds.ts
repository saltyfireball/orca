// Unattended resume (FORK.md, SLRM-2268, SLRM-2411): what a cut chat's saved conversation says
// before the pass continues it. Read the way stock reads an unopened chat's usage-limit cut
// (`readSavedUsageLimitCut`): the chat host has not opened these chats yet at start-up.
// - A person's Stop still in force (pressed on the cut turn, no send since) leaves it alone.
// - A newest turn that ended on a usage limit belongs to limit resume and its wait for the reset.
// Anything unreadable holds the chat: nothing then proves it is free to go on.
import type { JournalSqlDatabase } from '../../native-chat/agent-session-journal/database/journal-sql-database'
import { journalSqlReads } from '../../native-chat/agent-session-journal/journal-sql-reads'
import type { UnattendedResumeHold } from '../../../shared/fork/unattended-resume'

export type UnattendedResumeHoldDatabase = Pick<
  JournalSqlDatabase,
  'ensureSessionEpoch' | 'readers'
>

export async function readUnattendedResumeHold(
  database: UnattendedResumeHoldDatabase,
  sessionId: string
): Promise<UnattendedResumeHold | null> {
  try {
    if ((await database.ensureSessionEpoch(sessionId)) === null) {
      return 'hold-unknown'
    }
    const reads = journalSqlReads(database.readers, sessionId)
    const stop = await reads.queue({ kind: 'user-stop-in-force', facts: { reopenFloor: null } })
    if (stop.kind !== 'user-stop-in-force') {
      return 'hold-unknown'
    }
    if (stop.stop !== null) {
      return 'person-stopped'
    }
    return (await reads.usageLimitCut()) === null ? null : 'limit-wait'
  } catch (error) {
    console.warn('[fork-unattended-resume] reading a cut chat failed; leaving it:', error)
    return 'hold-unknown'
  }
}
