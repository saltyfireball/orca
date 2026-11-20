// Quick task (SLRM-2428, FORK.md): keeps the global shortcut in step with the settings. Only the
// accelerator this registered is ever unregistered, so other apps' and Orca's shortcuts stay put.
import { readForkQuickTaskConfig } from '../../../shared/fork/quick-task'

export type GlobalShortcutApi = {
  register: (accelerator: string, callback: () => void) => boolean
  unregister: (accelerator: string) => void
}

export type QuickTaskShortcutState =
  | { kind: 'off' }
  | { kind: 'registered'; accelerator: string }
  /** Another app holds it, or Electron refused the accelerator. */
  | { kind: 'refused'; accelerator: string }

export function forkQuickTaskShortcut(api: GlobalShortcutApi, onPress: () => void) {
  let registered: string | null = null
  let state: QuickTaskShortcutState = { kind: 'off' }

  const release = (): void => {
    if (registered) {
      api.unregister(registered)
      registered = null
    }
  }

  return {
    /** Registers what the settings ask for; a change unregisters the old one first. */
    apply(settings: unknown): QuickTaskShortcutState {
      const config = readForkQuickTaskConfig(settings)
      const wanted = config.enabled ? config.shortcut : null
      if (wanted !== null && wanted === registered) {
        return state
      }
      release()
      if (wanted === null) {
        state = { kind: 'off' }
        return state
      }
      let ok = false
      try {
        ok = api.register(wanted, onPress)
      } catch (error) {
        console.warn(`[quick-task] shortcut ${wanted} refused:`, error)
      }
      registered = ok ? wanted : null
      state = ok
        ? { kind: 'registered', accelerator: wanted }
        : { kind: 'refused', accelerator: wanted }
      if (!ok) {
        console.warn(
          `[quick-task] shortcut ${wanted} is taken by another app; the box has no shortcut`
        )
      }
      return state
    },
    state: (): QuickTaskShortcutState => state,
    /** At quit. */
    dispose(): void {
      release()
      state = { kind: 'off' }
    }
  }
}
