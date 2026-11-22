// BAD-679: automation spend windows and the refusal text, with hardcoded ledger entries.
import { describe, expect, it } from 'vitest'
import { FORK_USAGE_NO_TOKENS } from '../../../shared/fork/usage-ledger'
import { readAgentGuardSettings } from '../../../shared/fork/agent-guards'
import {
  anyAutomationCap,
  automationCapRefusal,
  automationSpend,
  automationWindows,
  effectiveAutomationCaps,
  type AutomationCapRun
} from './automation-caps'
import { applyAutomationCapChange, parseAutomationCapOverrides } from './automation-caps-state'
import type { UsageChatRecord } from '../usage-ledger/usage-ledger-model'

// Priced flat: 1 USD per 1000 output tokens of any model.
const pricer = (_model: string, tokens: { outputTokens: number }): number =>
  tokens.outputTokens / 1000

const chatOf = (days: Record<string, number>): Pick<UsageChatRecord, 'days'> => ({
  days: Object.fromEntries(
    Object.entries(days).map(([day, usd]) => [
      day,
      {
        'claude-sonnet-4-5': {
          tokens: { ...FORK_USAGE_NO_TOKENS, outputTokens: usd * 1000 },
          calls: 1
        }
      }
    ])
  )
})

const dayKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10)
const NOW = Date.parse('2026-11-22T12:00:00.000Z')

const run = (overrides: Partial<AutomationCapRun>): AutomationCapRun => ({
  createdAt: NOW,
  dispatchedAt: NOW,
  chatSessionId: null,
  terminalPaneKey: null,
  usage: null,
  ...overrides
})

describe('automation spend', () => {
  const chats: Record<string, Pick<UsageChatRecord, 'days'>> = {
    a: chatOf({ '2026-11-22': 3, '2026-11-20': 4 }),
    b: chatOf({ '2026-11-22': 2 }),
    c: chatOf({ '2026-11-10': 50 })
  }
  const runs = [
    run({ chatSessionId: 'a' }),
    // A reused session is one agent: counted once.
    run({ chatSessionId: 'a' }),
    run({ terminalPaneKey: 'b' }),
    run({ chatSessionId: 'c' }),
    // Not in the ledger: the cost the run recorded counts on its launch day.
    run({ usage: { status: 'known', estimatedCostUsd: 1.5 } }),
    run({ usage: { status: 'unavailable', estimatedCostUsd: 9 } })
  ]
  const byDay = automationSpend(runs, (key) => chats[key], pricer, dayKey)

  it('adds ledger days and recorded costs by local day', () => {
    expect(byDay.get('2026-11-22')).toBeCloseTo(6.5)
    expect(byDay.get('2026-11-20')).toBeCloseTo(4)
    expect(byDay.get('2026-11-10')).toBeCloseTo(50)
  })

  it('windows today and the last 7 days', () => {
    expect(automationWindows(byDay, NOW, dayKey)).toEqual({ dayUsd: 6.5, weekUsd: 10.5 })
  })
})

describe('automation caps', () => {
  const settings = readAgentGuardSettings({
    forkAutomationCapDayUsd: 5,
    forkAutomationCapWeekUsd: 20
  })

  it('follow the settings unless the automation has its own, where 0 is none', () => {
    expect(effectiveAutomationCaps(settings, undefined)).toEqual({
      runUsd: 0,
      dayUsd: 5,
      weekUsd: 20
    })
    expect(effectiveAutomationCaps(settings, { dayUsd: 0, runUsd: 2 })).toEqual({
      runUsd: 2,
      dayUsd: 0,
      weekUsd: 20
    })
    expect(anyAutomationCap(effectiveAutomationCaps(readAgentGuardSettings({}), undefined))).toBe(
      false
    )
  })

  it('skip runs past the day or week cap and say why', () => {
    const caps = { runUsd: 0, dayUsd: 5, weekUsd: 20 }
    expect(automationCapRefusal(caps, { dayUsd: 4.99, weekUsd: 10 })).toBeNull()
    expect(automationCapRefusal(caps, { dayUsd: 5, weekUsd: 10 })).toBe(
      "Skipped: this automation's runs spent $5.00 today, past its daily spend cap of $5.00. Runs resume when the day changes or the cap is raised."
    )
    expect(automationCapRefusal(caps, { dayUsd: 1, weekUsd: 21 })).toContain(
      'weekly spend cap of $20.00'
    )
    expect(
      automationCapRefusal({ runUsd: 3, dayUsd: 0, weekUsd: 0 }, { dayUsd: 99, weekUsd: 99 })
    ).toBeNull()
  })

  it('keep per-automation overrides, tolerating a bad file', () => {
    const overrides = parseAutomationCapOverrides(
      JSON.stringify({ automations: { a1: { dayUsd: 7, weekUsd: -1, runUsd: 'x' }, a2: 5 } })
    )
    expect([...overrides]).toEqual([['a1', { dayUsd: 7 }]])
    expect(applyAutomationCapChange(overrides, 'a1', { weekUsd: 30, dayUsd: null })).toEqual({
      weekUsd: 30
    })
    expect(applyAutomationCapChange(overrides, 'a1', { weekUsd: null })).toBeUndefined()
    expect(overrides.size).toBe(0)
  })
})
