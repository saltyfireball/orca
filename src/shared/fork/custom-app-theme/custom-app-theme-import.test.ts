import { describe, expect, it } from 'vitest'
import { contrastRatio } from './custom-app-theme-colors'
import { PUBLIC_TOKEN_SET } from './custom-app-theme-format'
import { deriveAppTokens, importCustomAppTheme } from './custom-app-theme-import'

// cyberdream by Scott McKendry, MIT License, Copyright (c) 2023 Scott McKendry.
// Verbatim from https://github.com/scottmckendry/cyberdream.nvim/blob/main/extras/ghostty/cyberdream
const CYBERDREAM_GHOSTTY = `# cyberdream theme for ghostty
palette = 0=#16181a
palette = 1=#ff6e5e
palette = 2=#5eff6c
palette = 3=#f1ff5e
palette = 4=#5ea1ff
palette = 5=#bd5eff
palette = 6=#5ef1ff
palette = 7=#ffffff
palette = 8=#3c4048
palette = 9=#ff6e5e
palette = 10=#5eff6c
palette = 11=#f1ff5e
palette = 12=#5ea1ff
palette = 13=#bd5eff
palette = 14=#5ef1ff
palette = 15=#ffffff

background = #16181a
foreground = #ffffff
cursor-color = #ffffff
selection-background = #3c4048
selection-foreground = #ffffff
`

// The cyberdream palette (lua/cyberdream/colors.lua) laid out as a base16 scheme.
const CYBERDREAM_BASE16_YAML = `scheme: "cyberdream"
author: "Scott McKendry"
base00: "16181a"
base01: "1e2124"
base02: "3c4048"
base03: "7b8496"
base04: "7b8496"
base05: "ffffff"
base06: "ffffff"
base07: "ffffff"
base08: "ff6e5e"
base09: "ffbd5e"
base0A: "f1ff5e"
base0B: "5eff6c"
base0C: "5ef1ff"
base0D: "5ea1ff"
base0E: "bd5eff"
base0F: "ff5ea0"
`

const CYBERDREAM_LIGHT_BASE24_YAML = `system: "base24"
name: "cyberdream light"
variant: "light"
palette:
  base00: "#ffffff"
  base01: "#eaeaea"
  base02: "#acacac"
  base03: "#7b8496"
  base04: "#7b8496"
  base05: "#16181a"
  base06: "#16181a"
  base07: "#16181a"
  base08: "#d11500"
  base09: "#d17c00"
  base0A: "#997b00"
  base0B: "#008b0c"
  base0C: "#008c99"
  base0D: "#0057d1"
  base0E: "#a018ff"
  base0F: "#f40064"
  base10: "#eaeaea"
  base11: "#ffffff"
  base12: "#f40064"
  base13: "#997b00"
  base14: "#008b0c"
  base15: "#008c99"
  base16: "#0057d1"
  base17: "#d100bf"
`

const CYBERDREAM_WARP_YAML = `name: cyberdream
accent: "#5ef1ff"
background: "#16181a"
foreground: "#ffffff"
details: darker
terminal_colors:
  normal:
    black: "#16181a"
    red: "#ff6e5e"
    green: "#5eff6c"
    yellow: "#f1ff5e"
    blue: "#5ea1ff"
    magenta: "#bd5eff"
    cyan: "#5ef1ff"
    white: "#ffffff"
  bright:
    black: "#3c4048"
    red: "#ff6e5e"
    green: "#5eff6c"
    yellow: "#f1ff5e"
    blue: "#5ea1ff"
    magenta: "#bd5eff"
    cyan: "#5ef1ff"
    white: "#ffffff"
`

describe('importCustomAppTheme', () => {
  it('reads a Ghostty theme and derives the chrome', () => {
    const result = importCustomAppTheme(CYBERDREAM_GHOSTTY, 'cyberdream')
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    const { theme } = result
    expect(theme).toMatchObject({
      name: 'cyberdream',
      base: 'dark',
      importedFrom: 'ghostty'
    })
    expect(theme.tokens['--background']).toBe('#16181a')
    expect(theme.tokens['--foreground']).toBe('#ffffff')
    expect(theme.tokens['--primary']).toBe('#5ea1ff')
    expect(theme.tokens['--diff-added']).toBe('#5eff6c')
    expect(theme.tokens['--chat-selection']).toBe('#3c4048')
    expect(theme.terminal).toMatchObject({
      background: '#16181a',
      cursor: '#ffffff',
      selectionBackground: '#3c4048',
      black: '#16181a',
      brightWhite: '#ffffff'
    })
  })

  it('reads a base16 scheme with its surfaces', () => {
    const result = importCustomAppTheme(CYBERDREAM_BASE16_YAML)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.theme).toMatchObject({
      name: 'cyberdream',
      author: 'Scott McKendry',
      base: 'dark',
      importedFrom: 'base16'
    })
    expect(result.theme.tokens['--sidebar']).toBe('#1e2124')
    expect(result.theme.tokens['--muted-foreground']).toBe('#7b8496')
    expect(result.theme.terminal?.brightBlack).toBe('#7b8496')
  })

  it('reads a base24 light scheme with its own bright colors', () => {
    const result = importCustomAppTheme(CYBERDREAM_LIGHT_BASE24_YAML)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.theme).toMatchObject({
      base: 'light',
      importedFrom: 'base24'
    })
    expect(result.theme.terminal?.brightRed).toBe('#f40064')
    expect(result.theme.terminal?.brightMagenta).toBe('#d100bf')
  })

  it('reads a base16 scheme given as JSON', () => {
    const json = JSON.stringify({
      scheme: 'J',
      base00: '000000',
      base05: 'ffffff',
      base0D: '0000ff'
    })
    const result = importCustomAppTheme(json)
    expect(result.ok && result.theme.importedFrom).toBe('base16')
  })

  it('reads a Warp theme and uses its accent', () => {
    const result = importCustomAppTheme(CYBERDREAM_WARP_YAML)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.theme).toMatchObject({
      name: 'cyberdream',
      importedFrom: 'warp'
    })
    expect(result.theme.tokens['--primary']).toBe('#5ef1ff')
    expect(result.theme.tokens['--text-link']).toBe('#5ea1ff')
    expect(result.theme.terminal?.brightBlack).toBe('#3c4048')
  })

  it('names the format it cannot read', () => {
    expect(importCustomAppTheme('hello there')).toEqual({
      ok: false,
      errors: [{ code: 'unknown-format' }]
    })
    expect(importCustomAppTheme('{ nope')).toEqual({
      ok: false,
      errors: [{ code: 'not-json' }]
    })
    expect(importCustomAppTheme('   ')).toEqual({
      ok: false,
      errors: [{ code: 'empty' }]
    })
    expect(importCustomAppTheme('palette = 0=#000000')).toEqual({
      ok: false,
      errors: [{ code: 'no-colors' }]
    })
  })

  it('never lets a palette value through that is not a color', () => {
    const result = importCustomAppTheme(
      'background = #000000\nforeground = red;}body{x\npalette = 1=#ff0000'
    )
    expect(result.ok).toBe(false)
  })
})

describe('deriveAppTokens', () => {
  it('only sets public tokens, all hex', () => {
    const tokens = deriveAppTokens({
      background: '#101010',
      foreground: '#f0f0f0',
      ansi: ['#000000', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff']
    })
    for (const [token, value] of Object.entries(tokens)) {
      expect(PUBLIC_TOKEN_SET.has(token), token).toBe(true)
      expect(value).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('keeps dim text readable when bright black is too dark', () => {
    const tokens = deriveAppTokens({
      background: '#16181a',
      foreground: '#ffffff',
      ansi: Array.from({ length: 9 }, (_, i) => (i === 8 ? '#1a1c1e' : undefined))
    })
    expect(contrastRatio(tokens['--muted-foreground'], '#16181a')).toBeGreaterThan(3.5)
  })

  it('picks the readable text color on the accent', () => {
    const tokens = deriveAppTokens({
      background: '#ffffff',
      foreground: '#111111',
      ansi: [],
      accent: '#ffff00'
    })
    expect(tokens['--primary-foreground']).toBe('#111111')
  })
})
