import { describe, expect, it } from 'vitest'
import { readForkDoneContractFlags } from './completion-contract-flag'

describe('readForkDoneContractFlags', () => {
  it('sends nothing without the flags', () => {
    expect(readForkDoneContractFlags(new Map())).toEqual({})
  })

  it('reads the checks, the PR requirement and the round limit', () => {
    expect(
      readForkDoneContractFlags(
        new Map<string, string | boolean>([
          ['done-check', 'pnpm check:changed'],
          ['require-pr-checks', true],
          ['done-max-rounds', '3']
        ])
      )
    ).toEqual({
      forkDoneChecks: ['pnpm check:changed'],
      forkRequirePrChecks: true,
      forkDoneMaxRounds: 3
    })
  })

  it('refuses an empty check and a round limit out of range', () => {
    expect(() => readForkDoneContractFlags(new Map([['done-check', true]]))).toThrow()
    expect(() => readForkDoneContractFlags(new Map([['done-max-rounds', '0']]))).toThrow()
  })
})
