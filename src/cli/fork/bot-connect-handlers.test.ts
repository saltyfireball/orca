import { describe, expect, it } from 'vitest'
import type { Bot } from '../../shared/bot-types'
import type { ConnectorLinearState } from '../../shared/connector-bot-linear-contract'
import type { ConnectorGitHubState } from '../../shared/connector-bot-github-contract'
import {
  formatBotConnectResult,
  hostReadOf,
  planBotConnect,
  readBotConnectWants,
  selectBotsToConnect,
  type HostRead
} from './bot-connect-handlers'

const bot = (name: string, extra: Partial<Bot> = {}): Bot =>
  ({ id: `id-${name}`, name, linear: null, github: null, ...extra }) as Bot

const flags = (entries: Record<string, string | boolean>) => new Map(Object.entries(entries))

const workspace = (id: string, installed = true) => ({
  workspaceId: id,
  name: `Team ${id}`,
  urlKey: id,
  installed,
  userId: 'u1',
  userName: 'Owner',
  defaultBotId: null
})

const linear = (...workspaces: ReturnType<typeof workspace>[]): HostRead<ConnectorLinearState> => ({
  ok: true,
  state: { installUrl: 'https://linear.example/install', workspaces }
})

const github = (
  account: { userId: string; login: string } | null,
  installs = 1
): HostRead<ConnectorGitHubState> => ({
  ok: true,
  state: {
    installUrl: 'https://github.example/install',
    account,
    installations: Array.from({ length: installs }, (_, i) => ({
      installationId: `${i + 1}`,
      accountLogin: 'owner',
      repositories: null
    })),
    defaultBotId: null
  }
})

const both = { linear: true, github: true }

describe('orca bot connect', () => {
  it('reads --linear and --github, and both when neither is given', () => {
    expect(readBotConnectWants(flags({}))).toEqual(both)
    expect(readBotConnectWants(flags({ linear: true }))).toEqual({
      linear: true,
      github: false
    })
    expect(readBotConnectWants(flags({ github: true }))).toEqual({
      linear: false,
      github: true
    })
  })

  it('picks one bot by name in any case, or every bot, and refuses neither or both', () => {
    const bots = [bot('Review'), bot('Station')]
    expect(selectBotsToConnect(bots, { bot: 'review', all: false }).map((b) => b.name)).toEqual([
      'Review'
    ])
    expect(selectBotsToConnect(bots, { all: true })).toHaveLength(2)
    expect(() => selectBotsToConnect(bots, { all: false })).toThrow('--bot <name>')
    expect(() => selectBotsToConnect(bots, { bot: 'Review', all: true })).toThrow('--bot <name>')
    expect(() => selectBotsToConnect(bots, { bot: 'Nope', all: false })).toThrow('No bot named')
  })

  it('links installed Linear workspaces and GitHub to a bot without them', () => {
    const [plan] = planBotConnect([bot('Review')], both, {
      linear: linear(workspace('bad'), workspace('other', false)),
      github: github({ userId: '7', login: 'owner' })
    })
    expect(plan.updates).toEqual({
      linearWorkspaces: [{ workspaceId: 'bad', workspaceName: 'Team bad', urlKey: 'bad' }],
      github: {}
    })
    expect(plan.linked).toEqual(['Linear bad', 'GitHub owner'])
    expect(plan.notes).toEqual(["Linear other: Orca's Linear app is not installed there yet"])
  })

  it('skips a bot already linked and keeps its own workspaces first', () => {
    const own = {
      workspaceId: 'bad',
      workspaceName: 'Team bad',
      urlKey: 'bad',
      ownerUserId: 'o'
    }
    const [linked, partial] = planBotConnect(
      [
        bot('Dispatcher', { linearWorkspaces: [own], github: {} }),
        bot('Station', { linear: own, linearWorkspaces: undefined })
      ],
      both,
      {
        linear: linear(workspace('bad'), workspace('two')),
        github: github({ userId: '7', login: 'owner' })
      }
    )
    expect(linked.updates).toEqual({
      linearWorkspaces: [own, { workspaceId: 'two', workspaceName: 'Team two', urlKey: 'two' }]
    })
    expect(linked.notes).toEqual(['Linear bad already linked', 'GitHub already linked'])
    expect(partial.updates.linearWorkspaces?.map((entry) => entry.workspaceId)).toEqual([
      'bad',
      'two'
    ])
  })

  it('starts no sign-in: says what is not connected or installed, and links nothing', () => {
    const [plan] = planBotConnect([bot('Review')], both, {
      linear: linear(),
      github: github(null)
    })
    expect(plan.updates).toEqual({})
    expect(plan.notes.join('\n')).toContain('Linear is not connected on this computer')
    expect(plan.notes.join('\n')).toContain('GitHub is not connected on this computer')
    const [noInstall] = planBotConnect(
      [bot('Review')],
      { linear: false, github: true },
      {
        github: github({ userId: '7', login: 'owner' }, 0)
      }
    )
    expect(noInstall.updates).toEqual({})
    expect(noInstall.notes).toEqual([
      'GitHub owner: the Orca GitHub app is not installed anywhere yet'
    ])
  })

  it('reports a host that could not be read, and touches only what was asked', () => {
    const [plan] = planBotConnect(
      [bot('Review')],
      { linear: true, github: false },
      {
        linear: { ok: false, message: 'signed out of Orca' },
        github: github({ userId: '7', login: 'owner' })
      }
    )
    expect(plan.updates).toEqual({})
    expect(plan.notes).toEqual(['Linear not read on this computer: signed out of Orca'])
  })

  it('reads the host answer the setup reads: its value, or its code', () => {
    expect(hostReadOf({ ok: true, value: 1 })).toEqual({ ok: true, state: 1 })
    expect(hostReadOf({ ok: false, error: 'signed_out' })).toEqual({
      ok: false,
      message: 'signed_out'
    })
  })

  it('prints each bot', () => {
    expect(
      formatBotConnectResult({
        bots: [
          {
            id: '1',
            name: 'Review',
            linked: ['Linear bad', 'GitHub owner'],
            notes: []
          },
          {
            id: '2',
            name: 'Dispatcher',
            linked: [],
            notes: ['GitHub already linked']
          }
        ]
      })
    ).toBe(
      'Review: linked Linear bad, GitHub owner\nDispatcher: nothing linked; GitHub already linked'
    )
  })
})
