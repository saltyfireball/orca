import { describe, expect, it } from 'vitest'
import { formatGuardsList, parseAutomationCapFlag, parseGuardsUsd } from './guards-handlers'

describe('orca guards', () => {
  it('says which agents a cap does not count, and how many of a Run (BAD-766)', () => {
    const text = formatGuardsList({
      now: 0,
      entries: [],
      runs: [{ rootId: 'lead', title: 'Plan', agents: 3, uncounted: 1, spentUsd: 1, capUsd: 5 }]
    })
    expect(text).toContain('3 (1 not counted)')
    expect(text).toContain('Not counted: agents with no usage record')
    expect(text).toContain('paired servers')
    expect(formatGuardsList({ now: 0, entries: [] })).not.toContain('Not counted')
  })

  it('lists paused, warned and capped agents with why', () => {
    const text = formatGuardsList({
      now: 10 * 60_000,
      entries: [
        {
          id: 'abc123',
          kind: 'chat',
          sessionId: 'abc123',
          agent: 'claude',
          title: 'Worker one',
          worktreeId: null,
          state: 'paused',
          reason: 'spend',
          since: 0,
          spentUsd: 5.5,
          capUsd: 5
        },
        {
          id: 'tab:1',
          kind: 'terminal',
          paneKey: 'tab:1',
          agent: 'codex',
          title: 'Codex',
          worktreeId: null,
          state: 'capped',
          reason: null,
          since: 0,
          spentUsd: 1,
          capUsd: 2
        }
      ]
    })
    expect(text).toContain('paused (spend) 10m')
    expect(text).toContain('capped chat $1.00/$2.00')
    expect(text).toContain('abc123: Paused: estimated spend $5.50 passed its cap of $5.00.')
    expect(formatGuardsList({ now: 0, entries: [] })).toBe('No agent is warned, paused or capped.')
  })

  it('shows every cap that covers an agent, and the Run and automation caps (BAD-679)', () => {
    const text = formatGuardsList({
      now: 0,
      entries: [
        {
          id: 'w1',
          kind: 'chat',
          sessionId: 'w1',
          agent: 'codex',
          title: 'Worker',
          worktreeId: null,
          state: 'capped',
          reason: null,
          since: 0,
          spentUsd: 9,
          capUsd: 10,
          scope: 'run',
          limits: [
            { scope: 'chat', capUsd: 5, spentUsd: 2 },
            { scope: 'run', capUsd: 10, spentUsd: 9 }
          ]
        }
      ],
      runs: [{ rootId: 'coord', title: 'Coordinator', agents: 3, spentUsd: 9, capUsd: 10 }],
      automations: [
        {
          id: 'auto1',
          name: 'Nightly',
          runCapUsd: 0,
          dayCapUsd: 4,
          weekCapUsd: 0,
          daySpentUsd: 4.5,
          weekSpentUsd: 6,
          skipping: true
        }
      ]
    })
    expect(text).toContain('capped chat $2.00/$5.00, run $9.00/$10.00')
    expect(text).toMatch(/coord\s+Coordinator\s+3\s+\$9.00\/\$10.00/)
    expect(text).toMatch(/auto1\s+Nightly\s+-\s+\$4.50\/\$4.00\s+-\s+skipping runs/)
    expect(
      formatGuardsList({
        now: 0,
        entries: [],
        automations: [
          {
            id: 'a',
            name: 'A',
            runCapUsd: 1,
            dayCapUsd: 0,
            weekCapUsd: 0,
            daySpentUsd: 0,
            weekSpentUsd: 0,
            skipping: false
          }
        ]
      })
    ).toContain('No agent is warned, paused or capped.')
  })

  it('reads an automation cap flag: USD, 0 for none, default to follow the setting', () => {
    expect(parseAutomationCapFlag(undefined, 'day')).toBeUndefined()
    expect(parseAutomationCapFlag('default', 'day')).toBeNull()
    expect(parseAutomationCapFlag('$7.5', 'day')).toBe(7.5)
    expect(parseAutomationCapFlag('0', 'week')).toBe(0)
    expect(() => parseAutomationCapFlag('-1', 'week')).toThrow('--week')
  })

  it('takes a cap in USD, with or without a dollar sign', () => {
    expect(parseGuardsUsd('$5')).toBe(5)
    expect(parseGuardsUsd('0')).toBe(0)
    expect(() => parseGuardsUsd('lots')).toThrow()
    expect(() => parseGuardsUsd('-1')).toThrow()
    expect(() => parseGuardsUsd(undefined)).toThrow()
  })
})
