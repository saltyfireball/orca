// Close one finished chat's tab with its history kept (FORK.md, BAD-848): the close the automation
// run sweep and `orca agent close` share. It refuses a chat whose agent is in a turn or waiting on
// a person, and closes the way an ended session closes (the agent stops, the tab is retired, the
// journal stays), so the chat reopens from its run or Session History.
import type { AgentSessionRecordStore } from '../../runtime/agent-session/records/agent-session-record-store'
import { closeStructuredAgentSessionChild } from '../../runtime/agent-session/lifecycle/structured-agent-session-close'
import type { StructuredSessionSurfaceRuntime } from '../../runtime/agent-session/lifecycle/structured-agent-session-close'
import { readStructuredSessionGateFacts } from '../../runtime/orchestration/mailbox/structured-pointer/structured-mailbox-pointer-host'

export type FinishedChatCloseResult =
  | { closed: true; alreadyClosed?: true }
  | { closed: false; reason: 'not-found' | 'working' | 'unreadable' | 'failed'; detail?: string }

export type FinishedChatCloseDeps = {
  records: Pick<AgentSessionRecordStore, 'getRecord' | 'isSessionTabVisible'>
  /** True while its agent is in a turn or waiting on a person; null when that cannot be read. */
  working: (sessionId: string) => Promise<boolean | null>
  closeSession: (sessionId: string) => Promise<{ stopped: boolean; reason?: string }>
}

export async function chatAgentWorking(
  records: Pick<AgentSessionRecordStore, 'getRecord'>,
  sessionId: string
): Promise<boolean | null> {
  if (records.getRecord(sessionId)?.lastTurn?.state === 'open') {
    return true
  }
  const facts = await readStructuredSessionGateFacts(sessionId)
  return facts ? facts.turnRunning || facts.awaitingHuman : null
}

export function runtimeFinishedChatCloseDeps(
  records: FinishedChatCloseDeps['records'],
  runtime?: StructuredSessionSurfaceRuntime
): FinishedChatCloseDeps {
  return {
    records,
    working: (sessionId) => chatAgentWorking(records, sessionId),
    closeSession: (sessionId) =>
      closeStructuredAgentSessionChild(sessionId, runtime ? { runtime } : {})
  }
}

export async function closeFinishedChat(
  deps: FinishedChatCloseDeps,
  sessionId: string
): Promise<FinishedChatCloseResult> {
  if (!deps.records.getRecord(sessionId)) {
    return { closed: false, reason: 'not-found' }
  }
  if (!deps.records.isSessionTabVisible(sessionId)) {
    return { closed: true, alreadyClosed: true }
  }
  const working = await deps.working(sessionId)
  if (working !== false) {
    return { closed: false, reason: working ? 'working' : 'unreadable' }
  }
  const outcome = await deps.closeSession(sessionId)
  return outcome.stopped
    ? { closed: true }
    : { closed: false, reason: 'failed', ...(outcome.reason ? { detail: outcome.reason } : {}) }
}
