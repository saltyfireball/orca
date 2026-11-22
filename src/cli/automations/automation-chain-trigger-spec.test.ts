import { describe, expect, it } from 'vitest'
import {
  describeAutomationEventTrigger,
  formatAutomationEventTrigger,
  parseAutomationEventTrigger
} from './automation-event-trigger-spec'

describe('automation.* triggers on the command line', () => {
  it('parses filters and round-trips through its --on text', () => {
    const rule = parseAutomationEventTrigger(
      'automation.run_failed automation=b,a bot=bot-1 depth=2'
    )
    expect(rule).toMatchObject({
      source: 'automation',
      event: 'run_failed',
      automation: ['a', 'b'],
      bot: ['bot-1'],
      maxDepth: 2
    })
    expect(parseAutomationEventTrigger(formatAutomationEventTrigger(rule))).toEqual(rule)
    expect(describeAutomationEventTrigger(rule)).toContain('fails')
  })

  it('refuses an unknown event, filter or depth', () => {
    expect(() => parseAutomationEventTrigger('automation.run_started')).toThrow(/Unknown event/)
    expect(() => parseAutomationEventTrigger('automation.run_failed in=x')).toThrow(
      /Unknown filter/
    )
    expect(() => parseAutomationEventTrigger('automation.run_failed depth=0')).toThrow(/depth=/)
    expect(() => parseAutomationEventTrigger('automation.run_failed depth=99')).toThrow(/depth=/)
  })
})
