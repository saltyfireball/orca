import { describe, expect, it } from 'vitest'
import { buildForkMemoryStatus, resolveForkMemorySettings } from '../../shared/fork/memory-truth'
import type { MemorySnapshot } from '../../shared/process-stats-types'
import { formatForkMemoryTruth, withForkMemoryTruth } from './memory-truth-format'

const GB = 1024 ** 3
const MB = 1024 ** 2

const truth = {
  metric: 'footprint' as const,
  grandTotal: 3 * GB,
  app: { total: GB, electron: 800 * MB, helpers: 100 * MB, terminalHost: 124 * MB },
  workspaces: [
    {
      worktreeId: 'w',
      worktreeName: 'feature',
      repoName: 'demo',
      memory: 2 * GB,
      cpu: 0,
      breakdown: { agent: GB, tools: GB, shells: 0, other: 0 },
      sessions: [
        {
          kind: 'chat' as const,
          sessionId: 'c1',
          provider: 'claude',
          pid: 400,
          memory: 2 * GB,
          cpu: 0,
          processCount: 5,
          orphanCount: 1,
          breakdown: { agent: GB, tools: GB, shells: 0, other: 0 }
        }
      ]
    }
  ],
  unattributed: [],
  status: buildForkMemoryStatus(
    {
      total: 32 * GB,
      used: 30 * GB,
      compressed: 4 * GB,
      swapUsed: 10 * GB,
      swapTotal: 12 * GB,
      pressure: 'warn',
      sampledAt: 1
    },
    resolveForkMemorySettings(null)
  )
}

describe('formatForkMemoryTruth', () => {
  it('prints the totals, system memory, the warning and each session', () => {
    expect(formatForkMemoryTruth(truth).split('\n')).toEqual([
      '',
      'orcaTotal: 3.0 GB (footprint, whole process trees)',
      'app: 1.0 GB (electron 800 MB, helpers 100 MB, terminal host 124 MB)',
      'system: used 30.0 GB of 32.0 GB, compressed 4.0 GB, swap 10.0 GB, pressure warn',
      'warning: over (pressure, swap); threshold pressure warn or swap 8 GB; new agents allowed',
      'workspaces:',
      '  demo / feature: 2.0 GB (agent 1.0 GB, tools 1.0 GB, shells 0 B, other 0 B)',
      '    chat claude c1 pid 400: 2.0 GB in 5 processes, 1 detached (agent 1.0 GB, tools 1.0 GB, shells 0 B, other 0 B)'
    ])
  })

  it('leaves upstream text alone when the runtime sent no fork section', () => {
    const format = withForkMemoryTruth(() => 'upstream')
    expect(format({} as MemorySnapshot)).toBe('upstream')
    expect(
      format({ forkTruth: truth } as unknown as MemorySnapshot).startsWith('upstream\n\norcaTotal')
    ).toBe(true)
  })
})
