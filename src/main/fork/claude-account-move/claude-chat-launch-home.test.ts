import { describe, expect, it } from 'vitest'
import { agentSessionRecordFixture } from '../../../shared/agent-session/lifecycle/agent-session-record.test-fixture'
import { claudeChatLaunchHome } from './claude-chat-launch-home'

const claudeRecord = {
  ...agentSessionRecordFixture(),
  provider: 'claude',
  accountHome: { variable: 'CLAUDE_CONFIG_DIR', path: '/accounts/work' }
}

describe('claudeChatLaunchHome', () => {
  it('names the founding home of a Claude chat that never launched', () => {
    expect(claudeChatLaunchHome(claudeRecord, 'local')).toEqual({
      home: '/accounts/work',
      accountId: null
    })
  })

  it('names no home for other providers or a missing record', () => {
    expect(claudeChatLaunchHome({ ...claudeRecord, provider: 'codex' }, 'local')).toEqual({
      home: null,
      accountId: null
    })
    expect(claudeChatLaunchHome(undefined, 'local')).toEqual({
      home: null,
      accountId: null
    })
  })
})
