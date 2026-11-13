import { describe, expect, it } from 'vitest'
import {
  forkMcpProfileConfigOf,
  forkMcpProfileExists,
  forkMcpProfilesInUse,
  isForkMcpProfileName,
  resolveForkMcpProfile,
  selectForkMcpServers
} from './mcp-profiles'

const config = forkMcpProfileConfigOf({
  forkMcpProfiles: [
    { name: 'web', mode: 'allow', servers: ['browser', 'fetch', 'fetch', ' '] },
    { name: 'quiet', mode: 'deny', servers: ['slack'] },
    { name: 'all', mode: 'allow', servers: [] },
    { name: 'bad name', mode: 'allow', servers: [] },
    { name: 'web', mode: 'deny', servers: [] }
  ],
  forkMcpDefaultWorker: 'quiet',
  forkMcpDefaultBackground: 'gone',
  forkMcpProjectProfiles: [
    { path: '/work/app/', profile: 'web' },
    { path: '/work/app/sub', profile: 'none' },
    { path: '', profile: 'web' }
  ]
})

describe('forkMcpProfileConfigOf', () => {
  it('defaults everything to all and changes nothing', () => {
    const empty = forkMcpProfileConfigOf({})
    expect(empty.defaults).toEqual({ interactive: 'all', worker: 'all', background: 'all' })
    expect(forkMcpProfilesInUse(empty)).toBe(false)
  })

  it('drops built-in, invalid and duplicate names and unknown defaults', () => {
    expect(config.profiles.map((p) => p.name)).toEqual(['web', 'quiet'])
    expect(config.profiles[0]!.servers).toEqual(['browser', 'fetch'])
    expect(config.defaults).toEqual({ interactive: 'all', worker: 'quiet', background: 'all' })
    expect(config.projects).toEqual([
      { path: '/work/app/', profile: 'web' },
      { path: '/work/app/sub', profile: 'none' }
    ])
    expect(forkMcpProfilesInUse(config)).toBe(true)
  })

  it('knows names', () => {
    expect(isForkMcpProfileName('a.b-c_1')).toBe(true)
    expect(isForkMcpProfileName('-x')).toBe(false)
    expect(forkMcpProfileExists(config.profiles, 'none')).toBe(true)
    expect(forkMcpProfileExists(config.profiles, 'nope')).toBe(false)
  })
})

describe('resolveForkMcpProfile', () => {
  it('prefers the chat choice, then the closest project, then the kind', () => {
    const folders = ['/work/app/sub/deep']
    expect(resolveForkMcpProfile(config, { chosen: 'web', kind: 'worker', folders })).toEqual({
      profile: 'web',
      source: 'chat'
    })
    expect(resolveForkMcpProfile(config, { kind: 'worker', folders })).toEqual({
      profile: 'none',
      source: 'project'
    })
    expect(resolveForkMcpProfile(config, { kind: 'worker', folders: ['/work/app'] })).toEqual({
      profile: 'web',
      source: 'project'
    })
    expect(resolveForkMcpProfile(config, { kind: 'worker', folders: ['/work/apple'] })).toEqual({
      profile: 'quiet',
      source: 'kind'
    })
  })

  it('falls through a deleted chat choice', () => {
    expect(
      resolveForkMcpProfile(config, { chosen: 'gone', kind: 'interactive', folders: [] })
    ).toEqual({ profile: 'all', source: 'kind' })
  })
})

describe('selectForkMcpServers', () => {
  const loadable = ['browser', 'slack', 'db']
  it('applies allow, deny and the built-ins', () => {
    expect(selectForkMcpServers(config, 'all', loadable)).toEqual(loadable)
    expect(selectForkMcpServers(config, 'none', loadable)).toEqual([])
    expect(selectForkMcpServers(config, 'web', loadable)).toEqual(['browser'])
    expect(selectForkMcpServers(config, 'quiet', loadable)).toEqual(['browser', 'db'])
    expect(selectForkMcpServers(config, 'gone', loadable)).toEqual([])
  })
})
