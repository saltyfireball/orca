// BAD-524: a worker started by a chat coordinator is linked to that chat, whichever way the
// coordinator spelled itself (mail address, structured tab id), for the usage rollup.
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../native-chat/agent-session-wire/host/structured-agent-session-registry', () => ({
  getStructuredAgentSessionHost: () => undefined
}))

import { forkAgentQueueNoteWorker, forkAgentQueueWorkerParent } from './agent-queue-service'

const COORDINATOR = '95dabf03-0601-498d-a154-def213f00add'

function note(sessionId: string, from: string | undefined): void {
  forkAgentQueueNoteWorker({
    session: { sessionId, handle: `handle-${sessionId}` },
    from,
    dispatchId: `ctx_${sessionId}`
  })
}

describe('forkAgentQueueWorkerParent', () => {
  it('links a worker to the coordinator named by its mail address', () => {
    note('11111111-1111-4111-8111-111111111111', `orca_session_id:${COORDINATOR}`)
    expect(forkAgentQueueWorkerParent('11111111-1111-4111-8111-111111111111')).toBe(COORDINATOR)
  })

  it('has no parent when the caller is unknown', () => {
    note('22222222-2222-4222-8222-222222222222', 'term_nothing')
    expect(forkAgentQueueWorkerParent('22222222-2222-4222-8222-222222222222')).toBeUndefined()
  })
})
