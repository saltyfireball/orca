import '../../runtime/rpc/unused-default-rpc-methods.test-fixture'
import { afterEach, describe, expect, it } from 'vitest'
import { agentSessionRecordFixture } from '../../../shared/agent-session/lifecycle/agent-session-record.test-fixture'
import { setStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import {
  call,
  clearStructuredHostStub,
  hostStub
} from '../../runtime/rpc/methods/structured-sessions/protocol/structured-agent-session-rpc.test-fixture'
import { SESSION } from '../../runtime/rpc/methods/structured-sessions/protocol/structured-agent-session-rpc-client.test-fixture'
import { FORK_CLAUDE_CHAT_HOME_METHOD } from '../../../shared/fork/claude-account-chip'
import { claudeChatHome } from './claude-chat-home-method'

afterEach(clearStructuredHostStub)

const claudeRecord = {
  ...agentSessionRecordFixture(),
  sessionId: SESSION,
  provider: 'claude',
  accountHome: { variable: 'CLAUDE_CONFIG_DIR', path: '/accounts/work' }
}

describe('fork claude chat home', () => {
  it('answers with the founding home of a Claude chat over the RPC', async () => {
    const host = hostStub()
    Object.assign(host, {
      deps: { store: { getRecord: () => claudeRecord, hostId: 'local' } }
    })
    setStructuredAgentSessionHost(host)
    const reply = await call(FORK_CLAUDE_CHAT_HOME_METHOD, {
      sessionId: SESSION
    })
    expect(reply?.ok && reply.result).toEqual({
      home: '/accounts/work',
      accountId: null
    })
  })

  it('names no home for other providers or a missing record', () => {
    expect(claudeChatHome({ ...claudeRecord, provider: 'codex' }, 'local')).toEqual({
      home: null,
      accountId: null
    })
    expect(claudeChatHome(undefined, 'local')).toEqual({
      home: null,
      accountId: null
    })
  })
})
