import { describe, expect, it } from 'vitest'
import { estimateCostUsd } from '../../claude-usage/claude-model-pricing'
import { formatUsageReport } from '../../../cli/fork/usage-report-handlers'
import { claudeUsageObservation } from './claude-usage-frames'
import { UsageLedger } from './usage-ledger'
import {
  buildUsageReport,
  cardMatcher,
  cleanUsagePrices,
  defaultUsagePrices,
  usagePricer,
  type UsageReportOptions
} from './usage-report'
import { assistantFrame, fakeClock, initFrame, RESULT_FRAME, utcDay } from './usage-ledger-fixtures'

const DAY = 86_400_000

/** Three chats over two days: a coordinator with a worker, and a subscription chat elsewhere. */
function fixture() {
  const clock = fakeClock()
  const ledger = new UsageLedger({ now: clock.now, dayKey: utcDay })
  const feed = (sessionId: string, frame: Record<string, unknown>) => {
    const observation = claudeUsageObservation(frame)
    if (observation) {
      ledger.observe(sessionId, observation)
    }
  }
  feed('lead', assistantFrame({ id: 'm1', input: 1_000_000, output: 100_000 }))
  feed('lead', RESULT_FRAME)
  ledger.noteMeta('lead', {
    title: 'Plan',
    workspaceId: 'ws-1',
    workspaceName: 'feat/ABC-12-login'
  })
  clock.advance(DAY)
  feed('worker', assistantFrame({ id: 'm2', input: 2_000_000 }))
  ledger.noteMeta('worker', {
    title: 'Build',
    workspaceId: 'ws-1',
    workspaceName: 'feat/ABC-12-login',
    parentSessionId: 'lead'
  })
  feed('sub', initFrame('none'))
  feed('sub', assistantFrame({ id: 'm3', input: 500_000, model: 'claude-opus-4-1' }))
  ledger.noteMeta('sub', { title: 'Docs', workspaceId: 'ws-2', workspaceName: 'docs-pass' })
  feed('odd', assistantFrame({ id: 'm4', input: 10, model: 'made-up-model' }))
  return { clock, data: ledger.snapshot() }
}

const FLAT = { 'claude-sonnet-4-5': { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 1 } }

function report(by: UsageReportOptions['by'], extra: Partial<UsageReportOptions> = {}) {
  const { clock, data } = fixture()
  return buildUsageReport(data, {
    by,
    now: clock.now(),
    dayKey: utcDay,
    pricer: usagePricer(FLAT),
    ...extra
  })
}

describe('buildUsageReport', () => {
  it('prices per-token chats with the user table and leaves subscription chats unbilled', () => {
    const result = report('chat')
    const byKey = Object.fromEntries(result.rows.map((row) => [row.key, row]))
    expect(byKey.lead.costUsd).toBeCloseTo(1 + 0.2)
    expect(byKey.worker.costUsd).toBeCloseTo(2)
    expect(byKey.sub).toMatchObject({ costUsd: null, subscriptionTokens: 500_000 })
    expect(byKey.odd).toMatchObject({ costUsd: null, unpricedTokens: 10 })
    expect(byKey.lead.detail).toBe('feat/ABC-12-login')
    expect(result.rows[0].key).toBe('worker')
    expect(result.total).toMatchObject({ chats: 4, calls: 4, subscriptionTokens: 500_000 })
    expect(result.total.costUsd).toBeCloseTo(3.2)
  })

  it('rolls workers up under the chat that dispatched them', () => {
    const rows = report('coordinator').rows
    const lead = rows.find((row) => row.key === 'lead')
    expect(lead).toMatchObject({ label: 'Plan', chats: 2, detail: '2 chats' })
    expect(lead?.totalTokens).toBe(3_100_000)
  })

  it('groups by workspace and by day, newest day first', () => {
    expect(
      report('workspace')
        .rows.map((row) => row.label)
        .sort()
    ).toEqual(['docs-pass', 'feat/ABC-12-login', '(no workspace)'].sort())
    const days = report('day').rows.map((row) => row.key)
    expect(days).toEqual(['2026-01-16', '2026-01-15'])
  })

  it('keeps only the last N days', () => {
    const result = report('day', { days: 1 })
    expect(result.rows.map((row) => row.key)).toEqual(['2026-01-16'])
    expect(result.days).toBe(1)
  })

  it('groups by the card the pattern finds, and reports a broken pattern', () => {
    const rows = report('card', { cardPattern: '([A-Z]+-\\d+)' }).rows
    expect(rows.map((row) => row.label).sort()).toEqual(['(no card)', 'ABC-12'])
    expect(report('card', { cardPattern: '(' }).cardPatternError).toBeTruthy()
    expect(report('card').rows.map((row) => row.label)).toEqual(['(no card)'])
  })
})

describe('prices', () => {
  it('uses the built-in table when the user has no row for a model', () => {
    const tokens = {
      inputTokens: 1000,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cacheWrite1hTokens: 0
    }
    expect(usagePricer({})('claude-sonnet-4-5', tokens)).toBe(
      estimateCostUsd('claude-sonnet-4-5', tokens)
    )
    expect(usagePricer({})('unknown', tokens)).toBeNull()
    expect(defaultUsagePrices()['claude-sonnet-4-5'].input).toBeGreaterThan(0)
  })

  it('applies a family row to a dated model id and charges 1 h writes at their own rate', () => {
    const pricer = usagePricer({
      'claude-sonnet-4-5': { input: 0, output: 0, cacheRead: 0, cacheWrite: 1, cacheWrite1h: 3 }
    })
    const cost = pricer('claude-sonnet-4-5-20250929', {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 2_000_000,
      cacheWrite1hTokens: 1_000_000
    })
    expect(cost).toBeCloseTo(4)
  })

  it('drops malformed price rows', () => {
    expect(
      cleanUsagePrices({
        good: { input: 1, output: 2, cacheRead: 0, cacheWrite: 1 },
        negative: { input: -1, output: 2, cacheRead: 0, cacheWrite: 1 },
        partial: { input: 1 },
        ' ': { input: 1, output: 2, cacheRead: 0, cacheWrite: 1 }
      })
    ).toEqual({ good: { input: 1, output: 2, cacheRead: 0, cacheWrite: 1 } })
  })

  it('reads the card from group 1 or the whole match', () => {
    expect(cardMatcher('proj-(\\d+)').card('feature/proj-42-x')).toBe('42')
    expect(cardMatcher('proj-\\d+').card('feature/PROJ-42-x')).toBe('PROJ-42')
    expect(cardMatcher('').card('anything')).toBeUndefined()
  })
})

describe('formatUsageReport', () => {
  it('prints a table with the estimate and subscription notes', () => {
    const text = formatUsageReport(report('chat'))
    expect(text).toContain('COST (EST.)')
    expect(text).toContain('subscription')
    expect(text).toContain('+?')
    expect(text).toContain('Costs are estimates')
  })

  it('says when nothing was recorded', () => {
    const empty = buildUsageReport(
      { version: 1, chats: {} },
      { by: 'chat', now: 0, pricer: usagePricer({}) }
    )
    expect(formatUsageReport(empty)).toContain('No usage recorded.')
  })
})
