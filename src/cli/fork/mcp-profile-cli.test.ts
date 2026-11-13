import { describe, expect, it } from 'vitest'
import type { CommandSpec } from '../args'
import { readForkMcpProfileFlag } from './mcp-profile-flag'
import { formatMcpChat, formatMcpListing } from './mcp-profile-format'
import { withForkMcpProfileFlag } from './mcp-profile-specs'

describe('readForkMcpProfileFlag', () => {
  it('reads, omits and refuses', () => {
    expect(readForkMcpProfileFlag(new Map())).toEqual({})
    expect(readForkMcpProfileFlag(new Map([['mcp-profile', 'web']]))).toEqual({
      forkMcpProfile: 'web'
    })
    expect(() => readForkMcpProfileFlag(new Map([['mcp-profile', 'a b']]))).toThrow(/--mcp-profile/)
    expect(() => readForkMcpProfileFlag(new Map([['mcp-profile', true]]))).toThrow()
  })
})

describe('withForkMcpProfileFlag', () => {
  it('adds the flag to launch commands only', () => {
    const spec = (path: string[]): CommandSpec => ({
      path,
      summary: 's',
      usage: `orca ${path.join(' ')} [--json]`,
      allowedFlags: ['json']
    })
    const [launch, other] = withForkMcpProfileFlag([
      spec(['agent', 'launch']),
      spec(['repo', 'list'])
    ])
    expect(launch!.allowedFlags).toContain('mcp-profile')
    expect(launch!.usage).toBe('orca agent launch [--mcp-profile <name>] [--json]')
    expect(other!.allowedFlags).toEqual(['json'])
  })
})

describe('format', () => {
  it('lists servers, profiles and defaults', () => {
    const text = formatMcpListing({
      folder: null,
      agent: 'claude',
      servers: [
        {
          name: 'browser',
          scope: 'user',
          status: 'enabled',
          transport: 'stdio',
          source: 'x',
          command: 'b'
        }
      ],
      notes: ['n'],
      profiles: [{ name: 'quiet', mode: 'deny', servers: ['slack'] }],
      defaults: { interactive: 'all', worker: 'quiet', background: 'none' },
      projects: [{ path: '/p', profile: 'quiet' }]
    })
    expect(text).toContain('browser')
    expect(text).toContain('quiet: all but slack')
    expect(text).toContain('workers quiet, background runs none')
    expect(text).toContain('/p: quiet')
    expect(text).toContain('note: n')
  })

  it('shows a chat and a pending change', () => {
    expect(formatMcpChat({ chat: null })).toMatch(/does not keep/)
    const text = formatMcpChat({
      chat: {
        sessionId: 's',
        provider: 'claude',
        kind: 'interactive',
        chosen: 'none',
        next: { profile: 'none', source: 'chat' },
        last: { at: 1, profile: 'web', applied: true, servers: ['browser'] },
        changePending: true,
        supported: true
      }
    })
    expect(text).toContain("next start: none (the chat's own choice)")
    expect(text).toContain('last start: web, with browser')
    expect(text).toContain('next starts')
  })
})
