// The upstream hook points. Kept free of app imports so the menu, IPC and updater modules can
// use them without loading the guard (or an import cycle); until it installs they pass through.
import type { RestartGuardKind } from './restart-guard-machine'

export type ForkRestartGuardHooks = {
  menuItems: () => Electron.MenuItemConstructorOptions[]
  guardRestart: (kind: RestartGuardKind, proceed: () => Promise<void>) => Promise<void>
  guardUpdateInstall: (install: () => void) => Promise<void>
}

let hooks: ForkRestartGuardHooks | null = null

export function setForkRestartGuardHooks(next: ForkRestartGuardHooks): void {
  hooks = next
}

/** App menu rows: "Update Ready - Restart When Idle", or the wait progress. */
export function forkRestartGuardMenuItems(): Electron.MenuItemConstructorOptions[] {
  return hooks?.menuItems() ?? []
}

/** Wraps a renderer restart; throws when held so the renderer drops its restart state. */
export function guardForkRestart(
  kind: RestartGuardKind,
  proceed: () => Promise<void>
): Promise<void> {
  return hooks ? hooks.guardRestart(kind, proceed) : proceed()
}

/** Wraps updater:quitAndInstall; a held install tells the renderer the install was aborted. */
export async function guardForkUpdateInstall(install: () => void): Promise<void> {
  if (hooks) {
    return hooks.guardUpdateInstall(install)
  }
  install()
}
