// BAD-686: `orca agent show` prints the guard line the host put on the row.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AGENT_CONVERSATION_HANDLERS } from '../agents/agent-conversations'
import type { HandlerContext } from '../dispatch/dispatch'

afterEach(() => {
  vi.restoreAllMocks()
})

const place = {
  orcaSessionId: 'orca-1',
  kind: 'terminal',
  agent: 'codex',
  state: 'working',
  worktreeId: 'repo1::/w',
  workspace: 'demo',
  paneKey: 'tab:1',
  title: null,
  lastAssistantMessage: null,
  updatedAt: 1,
  commandGuard: { guarded: false, note: 'unguarded: its hook cannot block a call' }
}

describe('agent show guard line', () => {
  it('prints the row guard line', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const client = {
      call: async () => ({
        id: '1',
        ok: true,
        result: { orcaSessionId: 'orca-1', kind: 'terminal', places: [place] },
        _meta: { runtimeId: 'r' }
      })
    }
    await AGENT_CONVERSATION_HANDLERS['agent show']({
      flags: new Map([['id', 'orca-1']]),
      client,
      cwd: '/',
      json: false
    } as unknown as HandlerContext)
    expect(String(log.mock.calls[0]?.[0])).toContain(
      '  command guard: unguarded: its hook cannot block a call'
    )
  })
})
