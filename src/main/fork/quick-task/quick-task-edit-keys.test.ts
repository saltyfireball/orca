import { describe, expect, it } from 'vitest'
import { quickTaskEditCommand } from './quick-task-edit-keys'

const key = (
  k: string,
  mods: Partial<{ meta: boolean; control: boolean; alt: boolean; shift: boolean }> = {}
) => ({
  type: 'keyDown' as const,
  key: k,
  meta: false,
  control: false,
  alt: false,
  shift: false,
  ...mods
})

describe('quickTaskEditCommand', () => {
  it('maps Cmd edit keys on macOS', () => {
    expect(quickTaskEditCommand(key('v', { meta: true }), 'darwin')).toBe('paste')
    expect(quickTaskEditCommand(key('c', { meta: true }), 'darwin')).toBe('copy')
    expect(quickTaskEditCommand(key('x', { meta: true }), 'darwin')).toBe('cut')
    expect(quickTaskEditCommand(key('a', { meta: true }), 'darwin')).toBe('selectAll')
    expect(quickTaskEditCommand(key('z', { meta: true }), 'darwin')).toBe('undo')
    expect(quickTaskEditCommand(key('Z', { meta: true, shift: true }), 'darwin')).toBe('redo')
  })

  it('maps Ctrl edit keys elsewhere, Ctrl+Y included', () => {
    expect(quickTaskEditCommand(key('v', { control: true }), 'linux')).toBe('paste')
    expect(quickTaskEditCommand(key('y', { control: true }), 'win32')).toBe('redo')
  })

  it('leaves other keys, key ups and the wrong modifier alone', () => {
    expect(quickTaskEditCommand(key('v'), 'darwin')).toBeNull()
    expect(quickTaskEditCommand(key('v', { control: true }), 'darwin')).toBeNull()
    expect(quickTaskEditCommand(key('v', { meta: true }), 'linux')).toBeNull()
    expect(quickTaskEditCommand(key('v', { meta: true, alt: true }), 'darwin')).toBeNull()
    expect(quickTaskEditCommand(key('v', { meta: true, shift: true }), 'darwin')).toBeNull()
    expect(quickTaskEditCommand(key('Enter', { meta: true }), 'darwin')).toBeNull()
    expect(
      quickTaskEditCommand({ ...key('v', { meta: true }), type: 'keyUp' }, 'darwin')
    ).toBeNull()
  })
})
