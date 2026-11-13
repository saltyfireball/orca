import { describe, expect, it } from 'vitest'
import {
  judgeForkProviderTree,
  parseForkProcessRows,
  type ForkProcessRow
} from './chat-stall-probe'

const row = (pid: number, ppid: number, pgid: number, stat = 'S'): ForkProcessRow => ({
  pid,
  ppid,
  pgid,
  stat
})

// A chat-survive tree: broker 100 leads its group, the supervisor 200 shares it, the writer 300
// leads its own group, a tool 400 runs under the writer.
const brokerTree = (stats: Partial<Record<number, string>> = {}): ForkProcessRow[] => [
  row(1, 0, 1),
  row(100, 1, 100, stats[100]),
  row(200, 100, 100, stats[200]),
  row(300, 200, 300, stats[300]),
  row(400, 300, 300, stats[400]),
  row(900, 1, 900, 'T')
]

describe('parseForkProcessRows', () => {
  it('reads ps lines and skips anything unreadable', () => {
    expect(parseForkProcessRows('  100     1   100 Ss\n  x y z\n\n 300 200 300 T+\n')).toEqual([
      row(100, 1, 100, 'Ss'),
      row(300, 200, 300, 'T+')
    ])
  })
})

describe('judgeForkProviderTree', () => {
  it('is alive when the chain runs', () => {
    expect(judgeForkProviderTree(100, brokerTree())).toEqual({ liveness: 'alive', stoppedPids: [] })
  })

  it('is gone when the root is missing or a zombie', () => {
    expect(judgeForkProviderTree(555, brokerTree()).liveness).toBe('gone')
    expect(judgeForkProviderTree(100, brokerTree({ 100: 'Z' })).liveness).toBe('gone')
  })

  it('is stopped when the writer under a broker is in the T state', () => {
    expect(judgeForkProviderTree(100, brokerTree({ 300: 'T' }))).toEqual({
      liveness: 'stopped',
      stoppedPids: [300]
    })
  })

  it('is stopped when the supervisor or the root is stopped', () => {
    expect(judgeForkProviderTree(100, brokerTree({ 200: 'T' })).liveness).toBe('stopped')
    expect(judgeForkProviderTree(100, brokerTree({ 100: 'T+' })).liveness).toBe('stopped')
  })

  it('reads a stopped tool as the tool, not the provider, but lists it for Wake', () => {
    expect(judgeForkProviderTree(100, brokerTree({ 400: 'T' }))).toEqual({
      liveness: 'alive',
      stoppedPids: [400]
    })
  })

  it('finds the writer under a supervisor root with no broker', () => {
    const rows = [row(200, 1, 200), row(300, 200, 300, 'T'), row(900, 1, 900, 'T')]
    expect(judgeForkProviderTree(200, rows)).toEqual({ liveness: 'stopped', stoppedPids: [300] })
  })

  it('lists every stopped process of a group stopped as a whole', () => {
    const verdict = judgeForkProviderTree(100, brokerTree({ 300: 'T', 400: 'T' }))
    expect(verdict.stoppedPids).toEqual([300, 400])
  })
})
