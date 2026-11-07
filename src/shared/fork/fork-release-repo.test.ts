import { describe, expect, it } from 'vitest'
import {
  assertForkReleaseRepo,
  forkReleaseRepoForChannel,
  isForkUpdateFeedUrl
} from './fork-release-repo'
import { getReleaseRepoForChannel, isChannelSupportedOnPlatform } from '../release-channel'

describe('fork release channels', () => {
  it('maps the stable channel to the fork and leaves the rest on their upstream repo', () => {
    expect(getReleaseRepoForChannel('stable')).toBe('saltyfireball/orca')
    expect(getReleaseRepoForChannel('rc')).toBe('stablyai/orca')
    expect(getReleaseRepoForChannel('hourly')).toBe('stablyai/orca-hourly')
    expect(forkReleaseRepoForChannel('daily', 'stablyai/orca-daily')).toBe('stablyai/orca-daily')
  })

  it('offers only the stable channel on every platform', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      expect(isChannelSupportedOnPlatform('stable', platform)).toBe(true)
      expect(isChannelSupportedOnPlatform('rc', platform)).toBe(false)
      expect(isChannelSupportedOnPlatform('hourly', platform)).toBe(false)
      expect(isChannelSupportedOnPlatform('daily', platform)).toBe(false)
      expect(isChannelSupportedOnPlatform('adhoc', platform)).toBe(false)
    }
  })
})

describe('assertForkReleaseRepo', () => {
  it('passes the fork repo through', () => {
    expect(assertForkReleaseRepo('saltyfireball/orca')).toBe('saltyfireball/orca')
    expect(assertForkReleaseRepo('SaltyFireball/Orca')).toBe('SaltyFireball/Orca')
  })

  it.each(['stablyai/orca', 'stablyai/orca-hourly', 'saltyfireball/orca-hourly', ''])(
    'rejects %j',
    (repo) => {
      expect(() => assertForkReleaseRepo(repo)).toThrow(/saltyfireball\/orca/)
    }
  )
})

describe('isForkUpdateFeedUrl', () => {
  it.each([
    'https://github.com/saltyfireball/orca/releases/latest/download',
    'https://github.com/saltyfireball/orca/releases/download/v1.4.252001',
    'http://127.0.0.1:51234/local-build'
  ])('accepts %s', (url) => {
    expect(isForkUpdateFeedUrl(url)).toBe(true)
  })

  it.each([
    'https://github.com/stablyai/orca/releases/latest/download',
    'https://github.com/stablyai/orca-hourly/releases/download/v1.4.160-hourly.202607281400',
    'https://github.com/saltyfireball/orca-evil/releases/download/v1',
    'https://github.com.evil.test/saltyfireball/orca/releases/download/v1',
    'https://user@github.com/saltyfireball/orca/releases/download/v1',
    'https://github.com:8443/saltyfireball/orca/releases/download/v1',
    'http://github.com/saltyfireball/orca/releases/download/v1',
    'http://localhost:51234/local-build',
    'http://192.168.1.5:51234/local-build',
    'not a url'
  ])('rejects %s', (url) => {
    expect(isForkUpdateFeedUrl(url)).toBe(false)
  })
})
