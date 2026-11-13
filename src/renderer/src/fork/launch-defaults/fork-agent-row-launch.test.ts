import { describe, expect, it } from 'vitest'
import { forkAgentRowTitle } from './fork-agent-row-launch'

describe('forkAgentRowTitle', () => {
  it('appends the model and effort, and says when the worker default chose them', () => {
    expect(forkAgentRowTitle('Working', { model: 'm', effort: 'e', source: 'fork-default' })).toBe(
      'Working\nModel m, effort e (worker default)'
    )
    expect(forkAgentRowTitle('Working', { model: 'm', source: 'explicit' })).toBe(
      'Working\nModel m'
    )
  })

  it('leaves the title alone without a known model', () => {
    expect(forkAgentRowTitle('Working', undefined)).toBe('Working')
    expect(forkAgentRowTitle('Working', { source: 'stock' })).toBe('Working')
  })
})
