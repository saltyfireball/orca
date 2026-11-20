import { describe, expect, it, vi } from 'vitest'
import { forkQuickTaskShortcut, type GlobalShortcutApi } from './quick-task-shortcut'
import { FORK_QUICK_TASK_DEFAULT_SHORTCUT } from '../../../shared/fork/quick-task'

function fakeShortcuts(taken: string[] = []) {
  const held = new Map<string, () => void>()
  const api: GlobalShortcutApi = {
    register: vi.fn((accelerator: string, callback: () => void) => {
      if (taken.includes(accelerator) || held.has(accelerator)) {
        return false
      }
      held.set(accelerator, callback)
      return true
    }),
    unregister: vi.fn((accelerator: string) => {
      held.delete(accelerator)
    })
  }
  return { api, held }
}

describe('forkQuickTaskShortcut', () => {
  it('registers the default shortcut and calls back on a press', () => {
    const { api, held } = fakeShortcuts()
    const press = vi.fn()
    const shortcut = forkQuickTaskShortcut(api, press)
    expect(shortcut.apply({})).toEqual({
      kind: 'registered',
      accelerator: FORK_QUICK_TASK_DEFAULT_SHORTCUT
    })
    held.get(FORK_QUICK_TASK_DEFAULT_SHORTCUT)!()
    expect(press).toHaveBeenCalledOnce()
  })

  it('does nothing when the settings change but the shortcut does not', () => {
    const { api } = fakeShortcuts()
    const shortcut = forkQuickTaskShortcut(api, vi.fn())
    shortcut.apply({})
    shortcut.apply({ forkQuickTaskRouterBot: 'Router' })
    expect(api.register).toHaveBeenCalledTimes(1)
    expect(api.unregister).not.toHaveBeenCalled()
  })

  it('unregisters the old shortcut before registering a new one', () => {
    const { api, held } = fakeShortcuts()
    const shortcut = forkQuickTaskShortcut(api, vi.fn())
    shortcut.apply({})
    shortcut.apply({ forkQuickTaskShortcut: 'Control+Alt+K' })
    expect(api.unregister).toHaveBeenCalledWith(FORK_QUICK_TASK_DEFAULT_SHORTCUT)
    expect([...held.keys()]).toEqual(['Control+Alt+K'])
  })

  it('lets go when the box is turned off or the shortcut is none', () => {
    const { api, held } = fakeShortcuts()
    const shortcut = forkQuickTaskShortcut(api, vi.fn())
    shortcut.apply({})
    expect(shortcut.apply({ forkQuickTask: false })).toEqual({ kind: 'off' })
    expect(held.size).toBe(0)
    shortcut.apply({})
    expect(shortcut.apply({ forkQuickTaskShortcut: 'none' })).toEqual({ kind: 'off' })
    expect(held.size).toBe(0)
  })

  it('reports a shortcut another app holds and tries again on the next change', () => {
    const { api } = fakeShortcuts([FORK_QUICK_TASK_DEFAULT_SHORTCUT])
    const shortcut = forkQuickTaskShortcut(api, vi.fn())
    expect(shortcut.apply({}).kind).toBe('refused')
    expect(api.unregister).not.toHaveBeenCalled()
    expect(shortcut.apply({ forkQuickTaskShortcut: 'Control+Alt+K' }).kind).toBe('registered')
  })

  it('treats a register that throws as refused', () => {
    const api: GlobalShortcutApi = {
      register: () => {
        throw new Error('bad accelerator')
      },
      unregister: vi.fn()
    }
    expect(forkQuickTaskShortcut(api, vi.fn()).apply({}).kind).toBe('refused')
  })

  it('unregisters only its own shortcut at quit', () => {
    const { api, held } = fakeShortcuts()
    const shortcut = forkQuickTaskShortcut(api, vi.fn())
    shortcut.apply({})
    shortcut.dispose()
    expect(api.unregister).toHaveBeenCalledTimes(1)
    expect(held.size).toBe(0)
    shortcut.dispose()
    expect(api.unregister).toHaveBeenCalledTimes(1)
  })
})
