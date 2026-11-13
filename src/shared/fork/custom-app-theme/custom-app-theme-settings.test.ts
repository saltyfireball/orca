import { describe, expect, it } from 'vitest'
import type { CustomAppThemeDraft } from './custom-app-theme-format'
import {
  activeCustomAppTheme,
  activeCustomAppThemePaintId,
  customAppThemePaint,
  deleteCustomAppThemeUpdate,
  renameCustomAppThemeUpdate,
  resetCustomAppThemeUpdate,
  saveCustomAppThemeUpdate,
  selectCustomAppThemeUpdate
} from './custom-app-theme-settings'

const NOW = new Date('2026-01-01T00:00:00Z')
const terminal = {
  background: '#000000',
  foreground: '#ffffff',
  red: '#ff0000'
}
const draft: CustomAppThemeDraft = {
  name: 'Night',
  base: 'dark',
  tokens: { '--background': '#000000', '--foreground': '#ffffff' },
  terminal,
  importedFrom: 'orca'
}

function saved(): ReturnType<typeof saveCustomAppThemeUpdate> & { ok: true } {
  const result = saveCustomAppThemeUpdate({}, draft, NOW)
  if (!result.ok) {
    throw new Error('save failed')
  }
  return result
}

describe('custom app theme settings', () => {
  it('saves with a unique id and refuses past the cap', () => {
    const first = saved()
    expect(first.id).toBe('night')
    const second = saveCustomAppThemeUpdate(first.update, draft, NOW)
    expect(second.ok && second.id).toBe('night-2')
    const full = Array.from({ length: 50 }, (_, i) => ({
      ...draft,
      id: `t${i}`,
      createdAt: ''
    }))
    expect(saveCustomAppThemeUpdate({ forkCustomAppThemes: full }, draft).ok).toBe(false)
  })

  it('changes nothing until a theme is picked', () => {
    const { update } = saved()
    expect(activeCustomAppTheme(update, true)).toBeNull()
    expect(activeCustomAppThemePaintId(update, true)).toBeNull()
  })

  it('uses a theme in its mode, switching mode and terminal, then resets', () => {
    const { update, id } = saved()
    const settings = {
      ...update,
      theme: 'light' as const,
      terminalThemeDark: 'Builtin Dark',
      terminalThemeLight: 'Builtin Light',
      terminalUseSeparateLightTheme: false
    }
    const use = selectCustomAppThemeUpdate(settings, id, false, true, NOW)
    expect(use).toMatchObject({
      forkCustomAppThemeDark: 'night',
      theme: 'dark',
      terminalThemeDark: 'custom:manual:app-theme-night',
      forkCustomAppThemeTerminalBefore: { terminalThemeDark: 'Builtin Dark' }
    })
    expect(use?.terminalCustomThemes?.[0]).toMatchObject({
      id: 'manual:app-theme-night',
      terminal
    })
    const after = { ...settings, ...use }
    expect(activeCustomAppTheme(after, true)?.id).toBe('night')
    expect(activeCustomAppTheme(after, false)).toBeNull()
    expect(activeCustomAppThemePaintId(after, true)).toBe('fork-custom:night')

    expect(resetCustomAppThemeUpdate(after)).toEqual({
      forkCustomAppThemeDark: null,
      forkCustomAppThemeLight: null,
      forkCustomAppThemeTerminalBefore: null,
      terminalThemeDark: 'Builtin Dark'
    })
  })

  it('keeps the terminal alone when asked', () => {
    const { update, id } = saved()
    expect(selectCustomAppThemeUpdate(update, id, true, false)).toEqual({
      forkCustomAppThemeDark: 'night'
    })
  })

  it('renames and refuses empty names', () => {
    const { update, id } = saved()
    expect(renameCustomAppThemeUpdate(update, id, '  Late  ')?.forkCustomAppThemes?.[0].name).toBe(
      'Late'
    )
    expect(renameCustomAppThemeUpdate(update, id, '   ')).toBeNull()
    expect(renameCustomAppThemeUpdate(update, 'missing', 'x')).toBeNull()
  })

  it('deletes the theme, its terminal entry and its selection', () => {
    const { update, id } = saved()
    const settings = { ...update, terminalThemeDark: 'Builtin Dark' }
    const used = {
      ...settings,
      ...selectCustomAppThemeUpdate(settings, id, true, true, NOW)
    }
    expect(deleteCustomAppThemeUpdate(used, id)).toEqual({
      forkCustomAppThemes: [],
      terminalCustomThemes: [],
      forkCustomAppThemeDark: null,
      forkCustomAppThemeTerminalBefore: null,
      terminalThemeDark: 'Builtin Dark'
    })
  })

  it('paints derived tokens under its own id', () => {
    const paint = customAppThemePaint({
      id: 'x',
      base: 'dark',
      tokens: draft.tokens
    })
    expect(paint.id).toBe('fork-custom:x')
    expect(paint.tokens['--card']).toBe('#000000')
    expect(paint.revision).toMatch(/^[0-9a-f]+$/)
  })
})
