// The update card's side of the restart guard (SLRM-1569): while an update install waits for
// busy chats the card shows the wait with Restart Now and Stop Waiting, and when the guard drops
// the install (Cancel, Stop Waiting) the card goes back to "Ready to Install" instead of staying
// on "Installing...". Kept free of Electron so it is tested against the real guard machine.
import {
  FORK_UPDATE_INSTALL_WAIT_CHANNELS,
  type ForkUpdateInstallWait
} from '../../../shared/fork/update-install-wait'
import type {
  RestartGuard,
  RestartGuardKind,
  RestartGuardProgress,
  RestartGuardRequestResult,
  RestartGuardWaitEnd
} from './restart-guard-machine'

export type UpdateInstallWaitDeps = {
  /** Sends to the main window, if there is one. */
  send: (channel: string, ...args: unknown[]) => void
  getGuard: () => Pick<RestartGuard, 'request' | 'getProgress' | 'resolveWaiting'>
  onError: (error: unknown) => void
}

export type UpdateInstallWait = {
  /** Every guard onProgress; pushes the update wait to the card when it changes. */
  progressChanged: (progress: RestartGuardProgress | null) => void
  /** The guard's onWaitEnded. */
  waitEnded: (kind: RestartGuardKind, end: RestartGuardWaitEnd) => void
  /** Wraps updater:quitAndInstall. */
  guardInstall: (install: () => void) => Promise<void>
  current: () => ForkUpdateInstallWait | null
  installNow: () => void
  stopWaiting: () => void
}

export function updateInstallWaitOf(
  progress: RestartGuardProgress | null
): ForkUpdateInstallWait | null {
  return progress?.kind === 'update'
    ? { total: progress.total, remaining: progress.remaining.length }
    : null
}

export function createUpdateInstallWait(deps: UpdateInstallWaitDeps): UpdateInstallWait {
  let sentKey = 'none'
  // Set when a wait ends: true if that already told the card (or ran the install).
  let endSettledCard = false

  const release = (): void => deps.send(FORK_UPDATE_INSTALL_WAIT_CHANNELS.released)

  return {
    progressChanged(progress) {
      const wait = updateInstallWaitOf(progress)
      const key = wait ? `${wait.total}:${wait.remaining}` : 'none'
      if (key !== sentKey) {
        sentKey = key
        deps.send(FORK_UPDATE_INSTALL_WAIT_CHANNELS.changed, wait)
      }
    },
    waitEnded(kind, end) {
      const releases = kind === 'update' && end === 'stopped'
      endSettledCard = releases || end === 'proceeded'
      if (releases) {
        release()
      }
    },
    async guardInstall(install) {
      endSettledCard = false
      let result: RestartGuardRequestResult
      try {
        result = await deps.getGuard().request('update', install)
      } catch (error) {
        deps.onError(error)
        result = 'proceed'
      }
      if (result === 'proceed') {
        install()
        return
      }
      deps.send('updater:quitAndInstallAborted')
      // 'waiting' shows on the card through progressChanged. 'cancelled' drops this install unless
      // an update wait is still on, or a wait ended during the request and settled the card itself
      // (Restart Now ran an intent; Stop Waiting on an update wait already released).
      if (
        result === 'cancelled' &&
        updateInstallWaitOf(deps.getGuard().getProgress()) === null &&
        !endSettledCard
      ) {
        release()
      }
    },
    current: () => updateInstallWaitOf(deps.getGuard().getProgress()),
    installNow: () => deps.getGuard().resolveWaiting('now'),
    stopWaiting: () => deps.getGuard().resolveWaiting('stop')
  }
}
