import { describe, expect, it } from 'vitest'
import { structuredAgentSessionStatusPaneKey } from '../../../../shared/agent-session/view/structured-agent-session-tab'
import { forkBotPlaceSessionId } from './fork-open-bot-place'

describe('forkBotPlaceSessionId', () => {
  it('reads the chat session back from the pane key its row carries', () => {
    const paneKey = structuredAgentSessionStatusPaneKey('11111111-1111-4111-8111-111111111111')
    expect(forkBotPlaceSessionId(paneKey)).toBe('11111111-1111-4111-8111-111111111111')
  })

  it('is null for a terminal pane key or none', () => {
    expect(forkBotPlaceSessionId('tab-1:leaf-1')).toBeNull()
    expect(forkBotPlaceSessionId('nocolon')).toBeNull()
  })
})
