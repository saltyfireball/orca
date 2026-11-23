import { describe, expect, it } from 'vitest'
import { findPrivateNames, parsePrivateNames } from './check-private-names.mjs'

describe('private names check', () => {
  it('reads terms without blanks and comments', () => {
    expect(parsePrivateNames('# mine\nalpha\n\n  beta.example \n')).toEqual([
      'alpha',
      'beta.example'
    ])
  })

  it('finds whole words only, case-insensitively, and reports locations not text', () => {
    const hits = findPrivateNames(['alpha', 'beta.example'], {
      'a.ts': 'const x = 1\nrun on ALPHA now',
      'b.ts': 'alphabet and beta-example',
      'c.ts': 'see beta.example/path'
    })
    expect(hits).toEqual(['a.ts:2', 'c.ts:1'])
  })

  it('finds nothing with an empty list', () => {
    expect(findPrivateNames([], { 'a.ts': 'anything' })).toEqual([])
  })
})
