import { describe, expect, it } from 'vitest'
import { formatPooledLimits } from './limits-usage-handler'

const NOW = 1_000_000

describe('formatPooledLimits', () => {
  it('prints each provider window, its accounts and the machines', () => {
    const text = formatPooledLimits({
      now: NOW,
      providers: [
        {
          provider: 'claude',
          accounts: [
            {
              provider: 'claude',
              label: 'work',
              plan: null,
              session: { usedPercent: 80, resetsAt: NOW + 3_600_000 },
              weekly: null,
              updatedAt: NOW,
              machines: ['this machine', 'kif']
            }
          ],
          windows: [
            {
              kind: 'session',
              usedPercent: 80,
              accounts: 1,
              nextResetAt: NOW + 3_600_000,
              freesPercent: 80
            }
          ]
        }
      ],
      machines: [
        { key: 'local', name: 'this machine', status: 'ok', accounts: 1 },
        { key: 'runtime:kif', name: 'kif', status: 'unreachable', accounts: 0 }
      ]
    })
    expect(text).toBe(
      [
        'Claude  1 account',
        '  5-hour  80% used   next reset in 1h frees 80%',
        '    work  5h 80%  wk -  on this machine, kif',
        'Machines: this machine (1), kif (not answering)'
      ].join('\n')
    )
  })

  it('says when pooled limits are off', () => {
    expect(formatPooledLimits({ now: NOW, off: true, providers: [], machines: [] })).toContain(
      'off'
    )
  })
})
