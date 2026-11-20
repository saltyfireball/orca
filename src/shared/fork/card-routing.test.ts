import { describe, expect, it } from 'vitest'
import {
  cardChatSubject,
  isCardChatSubject,
  readForkCardRoutes,
  resolveCardRoute,
  type CardFacts,
  type CardRouteBot
} from './card-routing'

const ROSTER: CardRouteBot[] = [
  { name: 'Dispatcher', specialty: 'Routes quick tasks to the bot that owns them.' },
  { name: 'Writer', specialty: 'Owns the docs site and release notes.' },
  { name: 'Builder', specialty: 'Owns the build pipeline and CI.' },
  { name: 'Mobile', specialty: 'Owns the phone app.' },
  { name: 'Sleepy', paused: true, specialty: 'Owns the docs search.' }
]

function card(over: Partial<CardFacts> = {}): CardFacts {
  return { key: 'ABC-7', title: 'Fix a thing', project: null, team: null, labels: [], ...over }
}

const routes = readForkCardRoutes({ forkCardRoutes: { ' Docs Site ': 'writer', ENG: 'Builder' } })

describe('resolveCardRoute', () => {
  it('sends a card to the bot its project maps to, in any case', () => {
    const route = resolveCardRoute(card({ project: 'docs site' }), ROSTER, routes)
    expect(route).toMatchObject({ kind: 'bot', via: 'project', source: 'docs site' })
    expect(route.kind === 'bot' && route.bot.name).toBe('Writer')
  })

  it('falls back to the team key when the project has no entry', () => {
    const route = resolveCardRoute(card({ project: 'Other', team: 'eng' }), ROSTER, routes)
    expect(route.kind === 'bot' && [route.via, route.bot.name]).toEqual(['team', 'Builder'])
  })

  it('lets a bot: label win over the project map', () => {
    const route = resolveCardRoute(
      card({ project: 'Docs Site', labels: ['Bug', 'bot:mobile'] }),
      ROSTER,
      routes
    )
    expect(route).toMatchObject({ kind: 'bot', via: 'label', source: 'bot:mobile' })
    expect(route.kind === 'bot' && route.bot.name).toBe('Mobile')
  })

  it('takes a label naming no running bot as no label, and says so', () => {
    const route = resolveCardRoute(
      card({ project: 'Docs Site', labels: ['bot: Sleepy'] }),
      ROSTER,
      routes
    )
    expect(route.kind === 'bot' && route.bot.name).toBe('Writer')
    expect(route.note).toBe("No running bot is named Sleepy (from the card's bot: label).")
  })

  it('offers 2 or 3 bots, never the router, when nothing names one', () => {
    const docs = resolveCardRoute(
      card({ title: 'Release notes for the docs site are stale' }),
      ROSTER,
      new Map(),
      ['dispatcher']
    )
    expect(docs.kind === 'choose' && docs.choices.map((bot) => bot.name)).toEqual([
      'Writer',
      'Builder'
    ])
    const vague = resolveCardRoute(card({ title: 'Something' }), ROSTER, new Map(), ['Dispatcher'])
    expect(vague.kind === 'choose' && vague.choices.map((bot) => bot.name)).toEqual([
      'Writer',
      'Builder'
    ])
  })

  it('offers at most 3 when more bots match', () => {
    const route = resolveCardRoute(card({ title: 'docs build phone' }), ROSTER, new Map(), [
      'Dispatcher'
    ])
    expect(route.kind === 'choose' && route.choices.map((bot) => bot.name)).toEqual([
      'Writer',
      'Builder',
      'Mobile'
    ])
  })
})

describe('readForkCardRoutes', () => {
  it('reads nothing from an unset or malformed map', () => {
    expect(readForkCardRoutes({}).size).toBe(0)
    expect(readForkCardRoutes({ forkCardRoutes: ['Docs'] }).size).toBe(0)
    expect([...readForkCardRoutes({ forkCardRoutes: { Docs: 3, '': 'X' } })]).toEqual([])
  })
})

describe('card chat subject', () => {
  it('is "KEY: summary", and marks the chat as the card\'s', () => {
    const subject = cardChatSubject({ key: 'abc-693', title: '  Task   brief  ' })
    expect(subject).toBe('ABC-693: Task brief')
    expect(isCardChatSubject(subject)).toBe(true)
    expect(isCardChatSubject('Fix the build')).toBe(false)
  })
})
