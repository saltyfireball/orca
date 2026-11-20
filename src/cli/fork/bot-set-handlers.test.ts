import { describe, expect, it } from 'vitest'
import type { Bot } from '../../shared/bot-types'
import type { BotLaunch } from '../../shared/bots/bot-launch'
import { formatBotSetResult, readBotLaunchChange, selectBotsToSet } from './bot-set-handlers'
import {
  forkBotDefaultLaunch,
  forkBotLaunchAfter,
  withForkBotDefaultLaunch
} from '../../shared/fork/launch-defaults/launch-defaults-bot'

const bot = (name: string, agent = 'claude', launch?: Bot['launch']): Bot =>
  ({ id: `id-${name}`, name, agent, ...(launch ? { launch } : {}) }) as Bot

const flags = (entries: Record<string, string | boolean>) => new Map(Object.entries(entries))

describe('orca bot set', () => {
  it('reads the change, and refuses nothing to set or --clear with a model', () => {
    expect(readBotLaunchChange(flags({ model: 'opus', effort: 'medium' }))).toEqual({
      model: 'opus',
      effort: 'medium'
    })
    expect(readBotLaunchChange(flags({ clear: true }))).toEqual({
      clear: true
    })
    expect(() => readBotLaunchChange(flags({}))).toThrow('Say what to set')
    expect(() => readBotLaunchChange(flags({ clear: true, model: 'opus' }))).toThrow('--clear')
  })

  it('picks one bot by name or id, or all of an agent', () => {
    const bots = [bot('Dispatcher'), bot('Cassie'), bot('Coder', 'codex')]
    expect(selectBotsToSet(bots, { bot: 'dispatcher', all: false }, {}).map((b) => b.name)).toEqual(
      ['Dispatcher']
    )
    expect(selectBotsToSet(bots, { bot: 'id-Cassie', all: false }, {})[0]?.name).toBe('Cassie')
    expect(
      selectBotsToSet(bots, { all: true, agent: 'claude' }, { model: 'opus' }).map((b) => b.name)
    ).toEqual(['Dispatcher', 'Cassie'])
    expect(selectBotsToSet(bots, { all: true }, { clear: true })).toHaveLength(3)
  })

  it('refuses no selection, both, an unknown bot and a model across agents', () => {
    const bots = [bot('Cassie'), bot('Coder', 'codex')]
    expect(() => selectBotsToSet(bots, { all: false }, {})).toThrow('--bot <name>')
    expect(() => selectBotsToSet(bots, { bot: 'Cassie', all: true }, {})).toThrow('--bot <name>')
    expect(() => selectBotsToSet(bots, { bot: 'Nope', all: false }, {})).toThrow('No bot named')
    expect(() => selectBotsToSet(bots, { all: true }, { model: 'opus' })).toThrow('--agent')
  })

  it('prints each bot changed', () => {
    expect(
      formatBotSetResult({
        bots: [
          {
            id: '1',
            name: 'Cassie',
            agent: 'claude',
            launch: { model: 'claude-opus-5-5', options: { effort: 'medium' } }
          },
          { id: '2', name: 'Dispatcher', agent: 'claude', launch: null }
        ]
      })
    ).toBe(
      'Cassie (claude): model claude-opus-5-5, effort medium\nDispatcher (claude): native chat defaults'
    )
  })
})

describe('bot launch changes', () => {
  it('sets the model and effort, keeping options only for the same model', () => {
    const current = {
      model: 'fable',
      options: { effort: 'high', fastMode: 'true' }
    }
    expect(forkBotLaunchAfter(current, { model: 'opus', effort: 'medium' })).toEqual({
      model: 'opus',
      options: { effort: 'medium' }
    })
    expect(forkBotLaunchAfter(current, { model: 'haiku' })).toEqual({
      model: 'haiku'
    })
    expect(forkBotLaunchAfter(current, { effort: 'low' })).toEqual({
      model: 'fable',
      options: { effort: 'low', fastMode: 'true' }
    })
    expect(forkBotLaunchAfter(current, { clear: true })).toBeNull()
  })
})

describe('the bot launch default', () => {
  const settings = {
    forkLaunchDefaults: {
      bot: { claude: { model: 'claude-opus-5-5', effort: 'medium' } }
    }
  }

  it('is the "bot" kind for the bot agent, and unset is none', () => {
    expect(forkBotDefaultLaunch(settings, 'claude')).toEqual({
      model: 'claude-opus-5-5',
      options: { effort: 'medium' }
    })
    expect(forkBotDefaultLaunch(settings, 'codex')).toBeUndefined()
    expect(forkBotDefaultLaunch({}, 'claude')).toBeUndefined()
    expect(forkBotDefaultLaunch(undefined, 'claude')).toBeUndefined()
  })

  type Create = { name: string; agent?: string; launch?: BotLaunch }

  it('fills only a create without a launch, on claude when no agent is named', () => {
    const plain: Create = { name: 'Milo' }
    expect(withForkBotDefaultLaunch(plain, settings)).toEqual({
      name: 'Milo',
      launch: { model: 'claude-opus-5-5', options: { effort: 'medium' } }
    })
    const router: Create = { name: 'Dispatcher', launch: { model: 'haiku' } }
    expect(withForkBotDefaultLaunch(router, settings)).toBe(router)
    expect(withForkBotDefaultLaunch(plain, {})).toBe(plain)
  })
})
