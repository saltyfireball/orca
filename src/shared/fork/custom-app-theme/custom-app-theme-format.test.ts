import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeThemeColor, toHex6 } from './custom-app-theme-colors'
import {
  exportCustomAppTheme,
  makeCustomAppThemeId,
  MAX_CUSTOM_APP_THEME_TEXT,
  normalizeCustomAppThemes,
  normalizeThemeFont,
  normalizeThemeRadius,
  parseCustomAppThemeObject,
  resolveCustomAppThemeTokens
} from './custom-app-theme-format'
import { importCustomAppTheme } from './custom-app-theme-import'
import { CYBERDREAM_EXAMPLE_TEXT, CYBERDREAM_EXAMPLE_THEME } from './cyberdream-example'

describe('normalizeThemeColor', () => {
  it.each([
    ['#ABCDEF', '#abcdef'],
    ['#abc', '#abc'],
    ['#11223344', '#11223344'],
    ['abcdef', '#abcdef'],
    ['rgb(1, 2, 3)', 'rgb(1, 2, 3)'],
    ['rgba(1 2 3 / 50%)', 'rgba(1 2 3 / 50%)'],
    ['hsl(210deg 40% 50%)', 'hsl(210deg 40% 50%)'],
    ['oklch(0.7 0.1 250)', 'oklch(0.7 0.1 250)'],
    ['rebeccapurple', 'rebeccapurple']
  ])('accepts %s', (input, expected) => {
    expect(normalizeThemeColor(input)).toBe(expected)
  })

  it.each([
    'red; background: url(x)',
    'var(--x)',
    'url(https://example.com/a.png)',
    'rgb(var(--a), 1, 2)',
    'calc(1px)',
    'color-mix(in srgb, red 50%, blue)',
    'inherit',
    'transparent',
    '#12',
    '',
    'x'.repeat(65),
    'expression(alert(1))',
    '}',
    42
  ])('rejects %s', (input) => {
    expect(normalizeThemeColor(input)).toBeNull()
  })

  it('expands short hex and drops alpha for math', () => {
    expect(toHex6('#abc')).toBe('#aabbcc')
    expect(toHex6('#11223344')).toBe('#112233')
    expect(toHex6('rgb(1,2,3)')).toBeNull()
  })
})

describe('font and radius', () => {
  it('takes plain family names only', () => {
    expect(normalizeThemeFont('JetBrains Mono')).toBe('JetBrains Mono')
    expect(normalizeThemeFont('a"; } body { x')).toBeNull()
    expect(normalizeThemeFont('x'.repeat(65))).toBeNull()
  })
  it('bounds the radius', () => {
    expect(normalizeThemeRadius('0.5rem')).toBe('0.5rem')
    expect(normalizeThemeRadius(6)).toBe('6px')
    expect(normalizeThemeRadius('3rem')).toBeNull()
    expect(normalizeThemeRadius('40px')).toBeNull()
    expect(normalizeThemeRadius('1em')).toBeNull()
  })
})

describe('parseCustomAppThemeObject', () => {
  it('accepts tokens with or without the leading dashes', () => {
    const result = parseCustomAppThemeObject({
      name: 'T',
      base: 'dark',
      tokens: { background: '#000000', '--foreground': '#ffffff' }
    })
    expect(result.ok && result.theme.tokens).toEqual({
      '--background': '#000000',
      '--foreground': '#ffffff'
    })
  })

  it('ignores unknown keys and tokens with warnings', () => {
    const result = parseCustomAppThemeObject({
      base: 'light',
      extra: 1,
      tokens: { background: '#ffffff', 'not-a-token': '#000000' }
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.theme.name).toBe('Custom theme')
      expect(result.theme.tokens).toEqual({ '--background': '#ffffff' })
      expect(result.warnings.map((w) => w.path)).toEqual(['extra', 'tokens.not-a-token'])
    }
  })

  it('reports every bad value with its path', () => {
    const result = parseCustomAppThemeObject({
      base: 'blue',
      tokens: { background: 'url(x)', sidebar: 'var(--a)' },
      terminal: { background: 'rgb(1,2,3)' },
      font: '"}',
      radius: '9rem'
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.map((e) => `${e.code}:${e.path}`)).toEqual([
        'bad-color:tokens.background',
        'bad-color:tokens.sidebar',
        'bad-terminal-color:terminal.background',
        'bad-base:base',
        'bad-font:font',
        'bad-radius:radius'
      ])
    }
  })

  it('infers the base from the background when it is missing', () => {
    const light = parseCustomAppThemeObject({
      tokens: { background: '#fafafa' }
    })
    expect(light.ok && light.theme.base).toBe('light')
    const none = parseCustomAppThemeObject({ tokens: { sidebar: '#fafafa' } })
    expect(none.ok).toBe(false)
  })

  it('refuses a theme with nothing in it', () => {
    const result = parseCustomAppThemeObject({ name: 'x', base: 'dark' })
    expect(result.ok ? null : result.errors[0].code).toBe('no-colors')
  })

  it('caps token maps', () => {
    const tokens = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`k${i}`, '#000000']))
    const result = parseCustomAppThemeObject({ base: 'dark', tokens })
    expect(result.ok ? null : result.errors[0].code).toBe('too-many-tokens')
  })

  it('drops an incomplete terminal palette with a warning', () => {
    const result = parseCustomAppThemeObject({
      base: 'dark',
      tokens: { background: '#000000' },
      terminal: { background: '#000000' }
    })
    expect(result.ok && result.theme.terminal).toBeUndefined()
    expect(result.ok && result.warnings[0].code).toBe('incomplete-terminal')
  })
})

describe('fallback', () => {
  it('derives omitted tokens from background and foreground', () => {
    const tokens = resolveCustomAppThemeTokens({
      tokens: { '--background': '#000000', '--foreground': '#ffffff' }
    })
    expect(tokens['--card']).toBe('#000000')
    expect(tokens['--sidebar']).toContain('color-mix')
    expect(tokens['--worktree-sidebar']).toBe(tokens['--sidebar'])
  })

  it('leaves the built-in colors alone without both', () => {
    expect(resolveCustomAppThemeTokens({ tokens: { '--sidebar': '#111111' } })).toEqual({
      '--sidebar': '#111111'
    })
  })
})

describe('stored list', () => {
  it('drops bad entries and bad values and caps the list', () => {
    const themes = normalizeCustomAppThemes([
      {
        id: 'ok',
        name: 'Ok',
        base: 'dark',
        tokens: { '--background': '#000', '--x': 'y' }
      },
      { id: 'ok', name: 'Dup', base: 'dark', tokens: {} },
      { id: 'Bad Id', base: 'dark', tokens: {} },
      { id: 'nobase', tokens: {} },
      {
        id: 'evil',
        base: 'light',
        tokens: { '--background': 'url(x)', '--foreground': '#000' },
        font: '"}'
      },
      ...Array.from({ length: 80 }, (_, i) => ({
        id: `t${i}`,
        base: 'dark',
        tokens: {}
      }))
    ])
    expect(themes[0]).toMatchObject({
      id: 'ok',
      tokens: { '--background': '#000' }
    })
    expect(themes[1]).toMatchObject({
      id: 'evil',
      tokens: { '--foreground': '#000' }
    })
    expect(themes[1].font).toBeUndefined()
    expect(themes).toHaveLength(50)
  })

  it('makes unique ids from names', () => {
    expect(makeCustomAppThemeId('My Theme!', [])).toBe('my-theme')
    expect(makeCustomAppThemeId('My Theme', ['my-theme', 'my-theme-2'])).toBe('my-theme-3')
    expect(makeCustomAppThemeId('***', [])).toBe('theme')
  })
})

describe('cyberdream example', () => {
  it('ships the same JSON in docs and code', () => {
    const doc = readFileSync(
      join(__dirname, '../../../../docs/fork/custom-app-themes/cyberdream.json'),
      'utf8'
    )
    expect(doc).toBe(CYBERDREAM_EXAMPLE_TEXT)
  })

  it('parses cleanly and round-trips through export', () => {
    const result = importCustomAppTheme(CYBERDREAM_EXAMPLE_TEXT)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.warnings).toEqual([])
    expect(result.theme).toMatchObject({
      name: 'cyberdream',
      base: 'dark',
      radius: '0.5rem',
      license: CYBERDREAM_EXAMPLE_THEME.license
    })
    expect(result.theme.terminal?.brightMagenta).toBe('#bd5eff')
    const again = importCustomAppTheme(exportCustomAppTheme(result.theme))
    expect(again.ok && again.theme).toEqual(result.theme)
  })

  it('refuses oversized text', () => {
    const result = importCustomAppTheme(' '.repeat(MAX_CUSTOM_APP_THEME_TEXT + 1))
    expect(result.ok ? null : result.errors[0].code).toBe('too-large')
  })
})
