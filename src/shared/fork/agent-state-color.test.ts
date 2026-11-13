import { describe, expect, it } from 'vitest'
import {
  FORK_AGENT_STATE_COLOR_DEFAULTS,
  FORK_AGENT_THEME_COLORS,
  forkAgentColorChoiceCss,
  forkAgentColorState,
  forkAgentStateColorChoice,
  forkAgentStateColorStyle,
  forkAgentStateColorsShowOn,
  forkAgentStateColorsStrength,
  forkAgentStateColorsWhere,
  resolveForkAgentColor
} from './agent-state-color'

const ON = { forkAgentStateColors: true } as const

describe('resolveForkAgentColor precedence', () => {
  const fixtures = [
    {
      name: 'a manual tab color wins over a state',
      input: { manualColor: '#ef4444', state: 'working' as const, settings: ON },
      expected: { source: 'manual', color: '#ef4444' }
    },
    {
      name: 'a manual color wins even with the feature off',
      input: { manualColor: '#22c55e', state: 'done' as const, settings: {} },
      expected: { source: 'manual', color: '#22c55e' }
    },
    {
      name: 'the state color with no manual color',
      input: { manualColor: null, state: 'working' as const, settings: ON },
      expected: { source: 'state', state: 'working', color: FORK_AGENT_THEME_COLORS.blue }
    },
    {
      name: 'a user-chosen hex for the state',
      input: {
        manualColor: undefined,
        state: 'needsYou' as const,
        settings: { ...ON, forkAgentStateColorsByState: { needsYou: '#ABCDEF' } }
      },
      expected: { source: 'state', state: 'needsYou', color: '#abcdef' }
    },
    {
      name: 'none when the state color is none',
      input: {
        manualColor: null,
        state: 'done' as const,
        settings: { ...ON, forkAgentStateColorsByState: { done: 'none' } }
      },
      expected: { source: 'none' }
    },
    {
      name: 'none when asleep keeps its shipped none',
      input: { manualColor: null, state: 'asleep' as const, settings: ON },
      expected: { source: 'none' }
    },
    {
      name: 'none with no state',
      input: { manualColor: null, state: null, settings: ON },
      expected: { source: 'none' }
    },
    {
      name: 'none while the feature is off',
      input: { manualColor: null, state: 'working' as const, settings: {} },
      expected: { source: 'none' }
    },
    {
      name: 'an empty manual color does not count as set',
      input: { manualColor: '', state: 'done' as const, settings: ON },
      expected: { source: 'state', state: 'done', color: FORK_AGENT_THEME_COLORS.green }
    }
  ]
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      expect(resolveForkAgentColor(fixture.input)).toEqual(fixture.expected)
    })
  }
})

describe('forkAgentColorState', () => {
  const fixtures = [
    { input: { dotState: 'permission' }, expected: 'needsYou' },
    { input: { dotState: 'waiting' }, expected: 'needsYou' },
    { input: { dotState: 'blocked', stalled: true }, expected: 'needsYou' },
    { input: { dotState: 'working', stalled: true }, expected: 'stalled' },
    { input: { dotState: 'working', unread: true }, expected: 'working' },
    { input: { dotState: 'monitoring' }, expected: 'working' },
    { input: { dotState: null, queued: true, unread: true }, expected: 'queued' },
    { input: { dotState: 'done', unread: true }, expected: 'unread' },
    { input: { dotState: 'done', asleep: true }, expected: 'done' },
    { input: { dotState: 'idle', asleep: true }, expected: 'asleep' },
    { input: { dotState: 'idle' }, expected: null },
    { input: { dotState: 'failed' }, expected: null },
    { input: { dotState: undefined }, expected: null }
  ]
  for (const { input, expected } of fixtures) {
    it(`${JSON.stringify(input)} -> ${expected}`, () => {
      expect(forkAgentColorState(input)).toBe(expected)
    })
  }
})

describe('settings readers', () => {
  it('ships off, on both surfaces, as a stripe', () => {
    expect(forkAgentStateColorsShowOn({}, 'tab')).toBe(false)
    expect(forkAgentStateColorsShowOn(undefined, 'row')).toBe(false)
    expect(forkAgentStateColorsWhere({})).toBe('both')
    expect(forkAgentStateColorsStrength({})).toBe('accent')
  })

  it('limits the surface when set', () => {
    const tabOnly = { ...ON, forkAgentStateColorsWhere: 'tab' as const }
    expect(forkAgentStateColorsShowOn(tabOnly, 'tab')).toBe(true)
    expect(forkAgentStateColorsShowOn(tabOnly, 'row')).toBe(false)
  })

  it('reads an unknown stored choice as the default', () => {
    const settings = { forkAgentStateColorsByState: { working: 'url(evil)' } }
    expect(forkAgentStateColorChoice(settings, 'working')).toBe(
      FORK_AGENT_STATE_COLOR_DEFAULTS.working
    )
  })

  it('never passes a raw CSS string through', () => {
    expect(forkAgentColorChoiceCss('red; background: url(x)')).toBeNull()
    expect(forkAgentColorChoiceCss('none')).toBeNull()
    expect(forkAgentColorChoiceCss('constructor')).toBeNull()
    expect(forkAgentColorChoiceCss('#abc')).toBe('#abc')
  })

  it('ships only theme variables as defaults, so they follow light, dark and custom themes', () => {
    for (const choice of Object.values(FORK_AGENT_STATE_COLOR_DEFAULTS)) {
      const css = forkAgentColorChoiceCss(choice)
      expect(css === null || css.startsWith('var(--')).toBe(true)
    }
  })
})

describe('forkAgentStateColorStyle', () => {
  it('draws only a stripe as an accent', () => {
    expect(forkAgentStateColorStyle('var(--primary)', 'accent')).toEqual({
      boxShadow: 'inset 2px 0 0 var(--primary)'
    })
  })

  it('adds a soft wash when tinted', () => {
    expect(forkAgentStateColorStyle('#22c55e', 'tint')).toEqual({
      boxShadow: 'inset 2px 0 0 #22c55e',
      backgroundColor: 'color-mix(in srgb, #22c55e 14%, transparent)'
    })
  })
})
