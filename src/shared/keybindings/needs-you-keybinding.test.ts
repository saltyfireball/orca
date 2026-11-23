// Needs you (FORK.md "Needs you list", BAD-759): the shortcut's default and where it runs.
import { describe, expect, it } from 'vitest'
import { getEffectiveKeybindingsForAction } from './effective'
import { findKeybindingConflicts } from './formatting'
import { resolveWindowShortcutAction } from './window-shortcut-policy'
import { nativeChatPromptClaimsShortcut } from './text-input-shortcut-policy'
import { KEYBINDING_DEFINITIONS } from './definitions'
import type { KeybindingInput } from './types'

const PLATFORMS: NodeJS.Platform[] = ['darwin', 'win32', 'linux']

function chord(platform: NodeJS.Platform): KeybindingInput {
  const mac = platform === 'darwin'
  return { key: 'L', code: 'KeyL', meta: mac, control: !mac, alt: false, shift: true }
}

describe('needsYou.open', () => {
  it('is bound by default to a chord no other shortcut has, on every platform', () => {
    for (const platform of PLATFORMS) {
      expect(getEffectiveKeybindingsForAction('needsYou.open', platform)).toEqual(['Mod+Shift+L'])
      const others = KEYBINDING_DEFINITIONS.filter(
        (definition) => definition.id !== 'needsYou.open'
      )
      for (const definition of others) {
        const bindings = getEffectiveKeybindingsForAction(definition.id, platform)
        expect(bindings.map((b) => b.toLowerCase())).not.toContain('mod+shift+l')
      }
      // The registry's own conflict check, main-process interception included.
      expect(
        findKeybindingConflicts(platform, {}, { includeMainProcessInterception: true })
      ).toEqual([])
    }
  })

  it('is taken by the window, so a terminal, a browser page and a text field cannot keep it', () => {
    for (const platform of PLATFORMS) {
      for (const context of ['app', 'terminal', 'browser'] as const) {
        expect(
          resolveWindowShortcutAction(chord(platform), platform, undefined, {
            context,
            terminalShortcutPolicy: 'orca-first'
          })
        ).toEqual({ type: 'openNeedsYou' })
      }
      // A chat composer is a text field: the chord is no editing key, so the app command stays.
      expect(nativeChatPromptClaimsShortcut(chord(platform), platform, 'needsYou.open', true)).toBe(
        false
      )
    }
  })

  it('follows a binding the owner chose in Settings', () => {
    const overrides = { 'needsYou.open': ['Mod+Alt+Y'] }
    expect(
      resolveWindowShortcutAction(chord('darwin'), 'darwin', overrides, { context: 'app' })
    ).toBeNull()
    expect(
      resolveWindowShortcutAction(
        { key: 'y', code: 'KeyY', meta: true, control: false, alt: true, shift: false },
        'darwin',
        overrides,
        { context: 'app' }
      )
    ).toEqual({ type: 'openNeedsYou' })
  })
})
