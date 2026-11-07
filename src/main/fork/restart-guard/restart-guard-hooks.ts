// The upstream hook points. Kept free of app imports so the menu, IPC and updater modules can
// use them without loading the guard (or an import cycle); until it installs they pass through.
import type { ForkRestartHeld } from '../../../shared/fork/restart-guard-held'
import type { RestartGuardKind } from './restart-guard-machine'

export type ForkRestartGuardHooks = {
  menuItems: () => Electron.MenuItemConstructorOptions[]
  guardRestart: (
    kind: RestartGuardKind,
    proceed: () => Promise<void>,
    deferred: () => Promise<void>
  ) => Promise<void | ForkRestartHeld>
  guardUpdateInstall: (install: () => void) => Promise<void>
  onUpdaterStatus: () => void
}

let hooks: ForkRestartGuardHooks | null = null

export function setForkRestartGuardHooks(next: ForkRestartGuardHooks): void {
  hooks = next
}

/** App menu rows: "Update Ready - Restart When Idle", or the wait progress. */
export function forkRestartGuardMenuItems(): Electron.MenuItemConstructorOptions[] {
  return hooks?.menuItems() ?? []
}

/**
 * Wraps a renderer restart; resolves a ForkRestartHeld (not an error) when the guard holds it.
 * `deferred` is what runs once a wait finishes, when the renderer is no longer preparing.
 */
export function guardForkRestart(
  kind: RestartGuardKind,
  proceed: () => Promise<void>,
  deferred: () => Promise<void> = proceed
): Promise<void | ForkRestartHeld> {
  return hooks ? hooks.guardRestart(kind, proceed, deferred) : proceed()
}

/** Wraps updater:quitAndInstall; a held install tells the renderer the install was aborted. */
export async function guardForkUpdateInstall(install: () => void): Promise<void> {
  if (hooks) {
    return hooks.guardUpdateInstall(install)
  }
  install()
}

/** The updater published a new status; the "Update Ready" menu row may change. */
export function notifyForkRestartGuardUpdaterStatus(): void {
  hooks?.onUpdaterStatus()
}
