import { describe, expect, it } from 'vitest'
import { forkReleaseNumber, nextForkVersion } from './fork-version.mjs'

describe('nextForkVersion', () => {
  it('starts a new upstream base at fork release 1', () => {
    expect(nextForkVersion('1.4.252', [])).toBe('1.4.252001')
  })

  it('counts up from the highest fork release on the same base, tags or versions', () => {
    expect(nextForkVersion('1.4.252', ['v1.4.252001', 'v1.4.252002'])).toBe('1.4.252003')
    expect(nextForkVersion('1.4.252', ['1.4.252007', 'v1.4.252003'])).toBe('1.4.252008')
  })

  it('resets for a new base and ignores releases of other bases and upstream tags', () => {
    expect(
      nextForkVersion('1.4.253', ['v1.4.252001', 'v1.4.252002', 'v1.4.253', 'v1.5.253001'])
    ).toBe('1.4.253001')
  })

  it('ignores prerelease and malformed tags', () => {
    expect(nextForkVersion('1.4.252', ['v1.4.252-fork.12', 'v1.4.252005-rc.1', 'latest'])).toBe(
      '1.4.252001'
    )
  })

  it('fails when a base has used every fork release number', () => {
    expect(nextForkVersion('1.4.252', ['v1.4.252998'])).toBe('1.4.252999')
    expect(() => nextForkVersion('1.4.252', ['v1.4.252999'])).toThrow(/overflow/)
  })

  it('refuses an upstream version that is not plain M.m.p', () => {
    expect(() => nextForkVersion('1.4.252-rc.1', [])).toThrow(/plain M\.m\.p/)
    expect(() => nextForkVersion('v1.4.252', [])).toThrow(/plain M\.m\.p/)
    expect(() => nextForkVersion('', [])).toThrow(/plain M\.m\.p/)
  })
})

describe('forkReleaseNumber', () => {
  it('reads N from a fork version of the same base', () => {
    expect(forkReleaseNumber('1.4.252', 'v1.4.252042')).toBe(42)
    expect(forkReleaseNumber('1.4.0', 'v1.4.1')).toBe(1)
  })

  it('returns null for the upstream tag itself and other bases', () => {
    expect(forkReleaseNumber('1.4.252', 'v1.4.252')).toBeNull()
    expect(forkReleaseNumber('1.4.252', 'v1.4.252000')).toBeNull()
    expect(forkReleaseNumber('1.4.252', 'v1.4.253001')).toBeNull()
    expect(forkReleaseNumber('1.4.252', 'v2.4.252001')).toBeNull()
  })
})
