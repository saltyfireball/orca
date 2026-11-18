import { describe, expect, it } from 'vitest'
import { formatGuardsList, parseGuardsUsd } from './guards-handlers'

describe('orca guards', () => {
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
    expect(text).toContain('capped $1.00/$2.00')
    expect(text).toContain('abc123: Paused: estimated spend $5.50 passed its cap of $5.00.')
    expect(formatGuardsList({ now: 0, entries: [] })).toBe('No agent is warned, paused or capped.')
  })

  it('takes a cap in USD, with or without a dollar sign', () => {
    expect(parseGuardsUsd('$5')).toBe(5)
    expect(parseGuardsUsd('0')).toBe(0)
    expect(() => parseGuardsUsd('lots')).toThrow()
    expect(() => parseGuardsUsd('-1')).toThrow()
    expect(() => parseGuardsUsd(undefined)).toThrow()
  })
})
