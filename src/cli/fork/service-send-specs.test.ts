import { describe, expect, it } from 'vitest'
import { COMMAND_SPECS } from '../specs'

describe('orchestration send --as-service spec (BAD-742)', () => {
  it('is a boolean flag on orchestration send only', () => {
    const withFlag = COMMAND_SPECS.filter((spec) => spec.allowedFlags.includes('as-service'))
    expect(withFlag.map((spec) => spec.path.join(' '))).toEqual(['orchestration send'])
    expect(withFlag[0]!.booleanFlags).toContain('as-service')
    expect(withFlag[0]!.usage).toContain('--as-service')
  })
})
