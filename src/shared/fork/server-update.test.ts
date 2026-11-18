import { describe, expect, it } from 'vitest'
import {
  compareForkVersions,
  forkMacCodeRequirement,
  normalizeForkReleasesUrl,
  parseForkMacManifest,
  parseForkSha256Sums,
  pickForkReleaseVersion,
  readForkServerUpdateConfig
} from './server-update'

describe('pickForkReleaseVersion', () => {
  it("keeps a release host version and swaps orcad's build string for its stamped release", () => {
    expect(pickForkReleaseVersion('1.4.262001', '1.4.250001')).toBe('1.4.262001')
    expect(pickForkReleaseVersion('0.1.0+081afb112818', ' 1.4.262001 ')).toBe('1.4.262001')
    expect(pickForkReleaseVersion('0.1.0+081afb112818', undefined)).toBe('0.1.0+081afb112818')
    expect(pickForkReleaseVersion('0.1.0+081afb112818', '0.0.0-dev')).toBe('0.1.0+081afb112818')
  })
})

const MAC_YML = `version: 1.4.261002
files:
  - url: Blackfish-1.4.261002-arm64-mac.zip
    sha512: JUdqgfvx1QMDRyO3YF61dGoo4Ano/wky9muoXnZNHGXsA6IcSb2vpSDXE9FUGhJUq8siPsag7qWIwWdZESOn6w==
    size: 290521030
  - url: orca-macos-arm64.dmg
    sha512: l0rUac7OFDNYUaPytP+rzGEkBHrG5y1lkLT4JQm7tUdVlIgbL2raDE2VCe1sJnJSrh4akufEz92FZ6QARhwN6Q==
    size: 288709496
path: Blackfish-1.4.261002-arm64-mac.zip
sha512: JUdqgfvx1QMDRyO3YF61dGoo4Ano/wky9muoXnZNHGXsA6IcSb2vpSDXE9FUGhJUq8siPsag7qWIwWdZESOn6w==
releaseDate: '2026-11-16T18:34:51.556Z'
`

describe('server update versions', () => {
  it('orders fork versions by their numbers, a local build below its release', () => {
    expect(compareForkVersions('1.4.261002', '1.4.259010')).toBe(1)
    expect(compareForkVersions('1.4.259010', '1.4.261002')).toBe(-1)
    expect(compareForkVersions('1.4.261002', '1.4.261002')).toBe(0)
    expect(compareForkVersions('1.4.261002-local.1.abc', '1.4.261002')).toBe(-1)
    expect(compareForkVersions('1.10.1', '1.9.999999')).toBe(1)
    expect(compareForkVersions('dev', '1.4.1')).toBeNull()
  })
})

describe('release manifests', () => {
  it('reads the top-level zip and sha512 of latest-mac.yml, not a file entry', () => {
    expect(parseForkMacManifest(MAC_YML)).toEqual({
      version: '1.4.261002',
      file: 'Blackfish-1.4.261002-arm64-mac.zip',
      sha512:
        'JUdqgfvx1QMDRyO3YF61dGoo4Ano/wky9muoXnZNHGXsA6IcSb2vpSDXE9FUGhJUq8siPsag7qWIwWdZESOn6w=='
    })
  })

  it('refuses a path that is not a plain zip name', () => {
    expect(
      parseForkMacManifest(MAC_YML.replace('path: Blackfish', 'path: ../Blackfish'))
    ).toBeNull()
  })

  it('finds a file in a sha256sum manifest, in text or binary mode', () => {
    const sums = [
      `${'a'.repeat(64)}  orca-server-linux-x64.tar.gz`,
      `${'B'.repeat(64)} *orca-server-linux-arm64.tar.gz`
    ].join('\n')
    expect(parseForkSha256Sums(sums, 'orca-server-linux-x64.tar.gz')).toBe('a'.repeat(64))
    expect(parseForkSha256Sums(sums, 'orca-server-linux-arm64.tar.gz')).toBe('b'.repeat(64))
    expect(parseForkSha256Sums(sums, 'orca-server-linux-riscv.tar.gz')).toBeNull()
  })
})

describe('server update settings', () => {
  it('takes https, or http only on loopback, and nothing with credentials or a query', () => {
    expect(normalizeForkReleasesUrl('https://example.com/o/r/releases/')).toBe(
      'https://example.com/o/r/releases'
    )
    expect(normalizeForkReleasesUrl('http://127.0.0.1:8080/feed')).toBe(
      'http://127.0.0.1:8080/feed'
    )
    expect(normalizeForkReleasesUrl('http://example.com/releases')).toBeNull()
    expect(normalizeForkReleasesUrl('https://user:pw@example.com/releases')).toBeNull()
    expect(normalizeForkReleasesUrl('https://example.com/releases?x=1')).toBeNull()
    expect(normalizeForkReleasesUrl('file:///tmp/releases')).toBeNull()
  })

  it('pins the fork certificate by default, a Team ID when one is set, and refuses a bad pin', () => {
    expect(forkMacCodeRequirement({})).toBe(
      'identifier "com.saltyfireball.orca" and certificate leaf = H"c5e8485cb550edea627fda93ead7cf1975ed3710"'
    )
    expect(forkMacCodeRequirement({ forkServerUpdateMacTeamId: 'ABCDE12345' })).toBe(
      'identifier "com.saltyfireball.orca" and anchor apple generic and certificate leaf[subject.OU] = "ABCDE12345"'
    )
    expect(
      forkMacCodeRequirement({ forkServerUpdateMacCertSha1: 'xyz" or anchor apple' })
    ).toBeNull()
    expect(readForkServerUpdateConfig({ forkServerUpdateReleasesUrl: 'http://evil.test' })).toEqual(
      {
        error: 'forkServerUpdateReleasesUrl must be an https address'
      }
    )
  })
})
