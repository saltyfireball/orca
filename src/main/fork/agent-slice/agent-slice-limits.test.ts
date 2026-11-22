import { describe, expect, it } from 'vitest'
import { applyAgentSliceLimits, requestedAgentSliceLimits } from './agent-slice-limits'

const GIB = 1024 ** 3
const facts = { ramBytes: 16 * GIB, swapBytes: 8 * GIB, pidMax: 4_194_304 }

describe('requestedAgentSliceLimits', () => {
  it('is off unless ORCA_AGENT_SLICE is set', () => {
    expect(requestedAgentSliceLimits({}, facts)).toBeNull()
  })

  it('sizes the defaults from RAM, swap and the task limit', () => {
    expect(requestedAgentSliceLimits({ ORCA_AGENT_SLICE: '1' }, facts)?.properties).toEqual([
      'CPUWeight=10',
      'IOWeight=10',
      'TasksMax=1048576',
      `MemoryHigh=${14 * GIB}`
    ])
  })

  it('takes overrides and reports invalid ones', () => {
    const request = requestedAgentSliceLimits(
      {
        ORCA_AGENT_SLICE: 'true',
        ORCA_AGENT_SLICE_CPU_WEIGHT: '50',
        ORCA_AGENT_SLICE_IO_WEIGHT: '0',
        ORCA_AGENT_SLICE_TASKS_MAX: '4096',
        ORCA_AGENT_SLICE_MEMORY_HIGH: '8G'
      },
      facts
    )
    expect(request?.properties).toEqual(['CPUWeight=50', 'TasksMax=4096', `MemoryHigh=${8 * GIB}`])
    expect(request?.invalid).toEqual(['ORCA_AGENT_SLICE_IO_WEIGHT'])
  })
})

describe('applyAgentSliceLimits', () => {
  it('applies each property alone and keeps only those the cgroup confirms', () => {
    const calls: string[][] = []
    const files: Record<string, string> = {
      '/cg/cpu.weight': '10',
      '/cg/io.weight': 'default 10',
      '/cg/pids.max': 'max'
    }
    const report = applyAgentSliceLimits({
      slice: 'orca_ptys_x.slice',
      sliceCgroupPath: '/cg',
      request: {
        properties: ['CPUWeight=10', 'IOWeight=10', 'TasksMax=500'],
        invalid: []
      },
      run: (args) => {
        calls.push(args)
        return { code: 0, timedOut: false }
      },
      readCgroupFile: (path) => files[path] ?? null
    })
    expect(calls[0]).toEqual([
      '--user',
      'set-property',
      '--runtime',
      'orca_ptys_x.slice',
      'CPUWeight=10'
    ])
    expect(report).toEqual({ applied: ['CPUWeight=10', 'IOWeight=10'], refused: ['TasksMax=500'] })
  })
})
